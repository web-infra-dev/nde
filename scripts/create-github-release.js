#!/usr/bin/env node

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Get package version
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = packageJson.version;
const tagName = `v${version}`;

// Check if tag exists
try {
	execSync(`git rev-parse ${tagName}`, { stdio: "pipe" });
} catch (error) {
	console.error(
		`❌ Tag ${tagName} does not exist. Please create the tag first.`,
	);
	process.exit(1);
}

// Get latest release notes from CHANGELOG.md
function getLatestReleaseNotes() {
	const changelogPath = path.join(process.cwd(), "CHANGELOG.md");

	if (!fs.existsSync(changelogPath)) {
		console.log("⚠️ CHANGELOG.md not found, using default release notes");
		return `Release ${tagName}`;
	}

	const changelog = fs.readFileSync(changelogPath, "utf8");
	const lines = changelog.split("\n");

	const releaseNotes = [];
	let inCurrentVersion = false;
	let foundVersion = false;

	for (const line of lines) {
		// Look for version header (e.g., ## 0.1.9 or ## [0.1.9])
		if (
			line.match(new RegExp(`##\\s*\\[?${version.replace(/\./g, "\\.")}\\]?`))
		) {
			inCurrentVersion = true;
			foundVersion = true;
			continue;
		}

		// Stop at next version header
		if (inCurrentVersion && line.startsWith("## ")) {
			break;
		}

		// Collect release notes
		if (inCurrentVersion) {
			releaseNotes.push(line);
		}
	}

	if (!foundVersion) {
		console.log(
			`⚠️ Version ${version} not found in CHANGELOG.md, using default release notes`,
		);
		return `Release ${tagName}`;
	}

	return releaseNotes.join("\n").trim() || `Release ${tagName}`;
}

// Create GitHub release
function createGitHubRelease() {
	const releaseNotes = getLatestReleaseNotes();

	console.log(`🚀 Creating GitHub release for ${tagName}...`);

	try {
		// Check if gh CLI is installed
		execSync("gh --version", { stdio: "pipe" });

		// Create release using GitHub CLI
		const command = [
			"gh",
			"release",
			"create",
			tagName,
			"--title",
			`Release ${tagName}`,
			"--notes",
			`"${releaseNotes}"`,
			"--latest",
		].join(" ");

		console.log(`📝 Release notes:\n${releaseNotes}\n`);

		execSync(command, { stdio: "inherit" });

		console.log(`✅ GitHub release ${tagName} created successfully!`);
		console.log(
			`🔗 View at: https://github.com/${getRepoInfo()}/releases/tag/${tagName}`,
		);
	} catch (error) {
		if (error.message.includes("gh: command not found")) {
			console.error(
				"❌ GitHub CLI (gh) is not installed. Please install it first:",
			);
			console.error("   brew install gh");
			console.error("   or visit: https://cli.github.com/");
		} else {
			console.error("❌ Error creating GitHub release:", error.message);
		}
		process.exit(1);
	}
}

// Get repository info from package.json
function getRepoInfo() {
	const repoUrl = packageJson.repository?.url || "";
	const match = repoUrl.match(
		/github\.com[\/:](.+?)(?:\.git)?(?:\/tree\/\w+)?$/,
	);
	return match ? match[1] : "unknown/repo";
}

// Main execution
if (require.main === module) {
	createGitHubRelease();
}

module.exports = { createGitHubRelease, getLatestReleaseNotes };
