#!/usr/bin/env zx

import 'zx/globals'
import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import fs from 'fs/promises'

$.verbose = true

const colors = {
  red: (text) => chalk.red(text),
  green: (text) => chalk.green(text),
  yellow: (text) => chalk.yellow(text),
}

console.log(colors.green('🚀 Starting release process...'))

let tagCreated = false
let commitCreated = false
let tagName = ''

// Cleanup function for rollback
async function cleanup() {
  if (tagCreated) {
    console.log(colors.yellow(`🔄 Removing tag ${tagName}...`))
    try {
      await $`git tag -d ${tagName}`
    } catch (error) {
      console.log(colors.red('⚠️ Failed to remove tag'))
    }
  }

  if (commitCreated) {
    console.log(colors.yellow('🔄 Rolling back commit...'))
    try {
      await $`git reset --hard HEAD~1`
    } catch (error) {
      console.log(colors.red('⚠️ Failed to rollback commit'))
    }
  }
}

try {
  const currentBranch = (await $`git branch --show-current`).stdout.trim()
  if (currentBranch !== 'main') {
    console.log(colors.red(`❌ Error: You must be on the main branch to release. Current branch: ${currentBranch}`))
    process.exit(1)
  }

  // Check if working directory is clean before starting
  const gitStatus = (await $`git status --porcelain`).stdout.trim()
  if (gitStatus) {
    console.log(colors.red('❌ Error: Working directory is not clean. Please commit or stash your changes first.'))
    console.log(colors.yellow('Uncommitted changes:'))
    console.log(gitStatus)
    process.exit(1)
  }

  console.log(colors.yellow('📥 Pulling latest changes...'))
  await $`git pull origin main`

  console.log(colors.yellow('🧪 Running tests...'))
  await $`pnpm test`

  console.log(colors.yellow('🔨 Building project...'))
  await $`pnpm build`

  const changesetFiles = existsSync('.changeset') ?
    (await readdir('.changeset')).filter(file => file.endsWith('.md') && file !== 'README.md') : []

  if (changesetFiles.length === 0) {
    console.log(colors.red("❌ Error: No changesets found. Please create a changeset first using 'pnpm change'"))
    process.exit(1)
  }

  console.log(colors.yellow('❓ Do you want to proceed with the release? (y/N)'))
  const confirm = await question('> ')
  if (confirm.toLowerCase() !== 'y') {
    console.log(colors.red('❌ Release cancelled.'))
    process.exit(1)
  }

  console.log(colors.yellow('📈 Versioning packages...'))
  await $`pnpm bump`

  // Get the new version from package.json
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'))
  const newVersion = packageJson.version
  tagName = `v${newVersion}`

  console.log(colors.yellow(`📝 Committing version changes for ${tagName}...`))
  await $`git add .`
  await $`git commit -m "chore: release ${tagName}"`
  commitCreated = true

  console.log(colors.yellow(`🏷️ Creating git tag ${tagName}...`))
  await $`git tag ${tagName}`
  tagCreated = true

  console.log(colors.yellow('📋 About to publish:'))
  await $`git log --oneline -n 5`

  console.log(colors.yellow('❓ Ready to publish and push to GitHub? (y/N)'))
  const finalConfirm = await question('> ')
  if (finalConfirm.toLowerCase() !== 'y') {
    console.log(colors.red('❌ Release cancelled.'))
    await cleanup()
    process.exit(1)
  }

  // Check for npm token in environment variable
  const npmToken = process.env.NPM_TOKEN

  if (npmToken) {
    console.log(colors.green('🔑 Using NPM_TOKEN from environment variable'))
    // Configure npm registry auth token via user-level config
    // Use automation token (no 2FA required) from: https://www.npmjs.com/settings/<your-username>/tokens
    // This doesn't modify project .npmrc file, only sets user-level config
    await $`pnpm config set //registry.npmjs.org/:_authToken ${npmToken}`
    console.log(colors.green('✅ Configured npm authentication'))
  }

  console.log(colors.yellow('📤 Publishing to npm...'))
  await $`pnpm publish`

  console.log(colors.yellow('🔗 Pushing to GitHub...'))
  await $`git push origin main --follow-tags`

  console.log(colors.yellow('📋 Creating GitHub Release...'))
  await $`node scripts/create-github-release.js`

  console.log(colors.green('✅ Release completed successfully!'))
  console.log(colors.green(`🎉 Check GitHub releases and npm for version ${newVersion}.`))

} catch (error) {
  console.log(colors.red(`❌ Error during release: ${error.message}`))
  console.log(colors.red(`   ${error.stack || ''}`))

  // Only cleanup if we haven't pushed to remote yet
  const gitRemoteStatus = await $`git status --porcelain -b`.catch(() => ({ stdout: '' }))
  const hasUnpushedCommits = gitRemoteStatus.stdout.includes('[ahead')

  if (hasUnpushedCommits || (!gitRemoteStatus.stdout.includes('origin'))) {
    console.log(colors.yellow('🔄 Attempting to rollback local changes...'))
    await cleanup()
  } else {
    console.log(colors.yellow('⚠️ Changes have been pushed to remote. Manual intervention may be required.'))
  }

  process.exit(1)
}
