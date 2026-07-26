# Releasing ndepe

Releases are prepared and published locally. GitHub Actions only validates pull requests and has no publishing credentials or write permissions.

## Feature development

Every pull request with a user-visible change must include one or more changesets:

```bash
pnpm change
```

Commit the generated `.changeset/*.md` files with the feature. Changesets accumulate on `main`; merging a feature pull request does not create a version pull request or publish anything.

## Prepare a release

The maintainer starts a short release window and pauses feature merges. From a clean and current `main`, run:

```bash
pnpm release:prepare
```

The command verifies Node.js 22, pnpm 10, GitHub CLI authentication, Git state, frozen dependencies, pending changesets, and the release branch. It then consumes every pending changeset, creates `release/vX.Y.Z`, commits the version files, pushes the branch, and opens a Version PR.

Review the version, changelog, deleted changesets, and CI result. The Version PR must contain no source changes and must be merged with **Squash Merge**.

## Publish a release

Keep the release window open. Immediately after the Version PR is merged:

```bash
git switch main
git pull --ff-only origin main
pnpm release
```

The command requires a local npm login with 2FA and rejects `NPM_TOKEN` and `NODE_AUTH_TOKEN`. It installs the lockfile-pinned dependencies with lifecycle scripts disabled, verifies that `HEAD` is exactly the Version commit, runs lint/build/tests and package smoke tests, then asks you to type the complete version.

After confirmation it publishes the generated tarball, creates and pushes an annotated Tag, and creates the GitHub Release from the matching changelog section. End the release window only after all three commands succeed.

Stable SemVer releases are supported. Prereleases are intentionally not supported in the first version of this flow.

## Recovery

The script never overwrites an npm version or Tag and does not perform automatic rollback. If npm publishing succeeds but a later step fails, do not rerun the complete release command. Inspect the printed version and commit, then complete the missing steps manually:

```bash
git tag -a vX.Y.Z <release-commit-sha> -m "vX.Y.Z" # Skip if the local Tag exists
git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z

# Copy the matching CHANGELOG section to /tmp/release-notes.md first.
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" \
  --notes-file /tmp/release-notes.md --latest --repo web-infra-dev/nde
```

Before running recovery commands, verify npm contains the expected version and that any existing Tag points to the intended release commit. Never move an existing remote Tag automatically.

If the package was published under the wrong dist-tag, restore the stable tag explicitly:

```bash
npm dist-tag add ndepe@X.Y.Z latest
```

## Repository setup

Repository administrators must configure these controls outside the repository:

- Require pull requests and the CI check for `main`.
- Allow and use Squash Merge for Version PRs.
- Restrict creation of `v*` Tags to release maintainers.
- Remove the obsolete `NPM_TOKEN` GitHub secret.
- On npm, require 2FA for publishing and disallow automation tokens.

Historical Tags are not moved or recreated. The local flow starts with the next release.
