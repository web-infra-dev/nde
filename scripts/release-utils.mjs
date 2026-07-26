import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const NPM_REGISTRY = "https://registry.npmjs.org";
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_FILES = new Set([
	"package.json",
	"CHANGELOG.md",
	"pnpm-lock.yaml",
]);

export class CommandError extends Error {
	constructor(command, result) {
		const details = [result.stderr, result.stdout]
			.filter(Boolean)
			.join("\n")
			.trim();
		super(`Command failed: ${command}${details ? `\n${details}` : ""}`);
		this.name = "CommandError";
		this.status = result.status;
		this.stdout = result.stdout;
		this.stderr = result.stderr;
	}
}

export function run(command, args = [], options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...options.env },
		encoding: "utf8",
		stdio: options.stdio ?? "pipe",
	});
	if (result.error) throw result.error;

	const output = {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
	if (!(options.allowExitCodes ?? [0]).includes(output.status)) {
		throw new CommandError([command, ...args].join(" "), output);
	}
	return output;
}

export function assertStableVersion(version) {
	if (!STABLE_SEMVER.test(version)) {
		throw new Error(
			`Only stable SemVer releases are supported; found ${version}`,
		);
	}
}

export function assertVersionIncreased(previousVersion, nextVersion) {
	assertStableVersion(previousVersion);
	assertStableVersion(nextVersion);
	const previous = previousVersion.split(".").map(Number);
	const next = nextVersion.split(".").map(Number);
	for (let index = 0; index < 3; index += 1) {
		if (next[index] === previous[index]) continue;
		if (next[index] > previous[index]) return;
		break;
	}
	throw new Error(
		`Version must increase from ${previousVersion} to ${nextVersion}`,
	);
}

export function assertOnlyPackageVersionChanged(previousPackage, nextPackage) {
	const previous = { ...previousPackage, version: nextPackage.version };
	if (!isDeepStrictEqual(previous, nextPackage)) {
		throw new Error("Version commits may only change package.json version");
	}
}

export function assertAuthenticatedTools({ npm = false } = {}) {
	const nodeMajor = Number(process.version.slice(1).split(".")[0]);
	const pnpmVersion = run("pnpm", ["--version"]).stdout.trim();
	if (nodeMajor !== 22)
		throw new Error(`Node.js 22 is required; found ${process.version}`);
	if (Number(pnpmVersion.split(".")[0]) !== 10) {
		throw new Error(`pnpm 10 is required; found ${pnpmVersion}`);
	}
	run("gh", ["auth", "status", "--hostname", "github.com"]);
	if (npm) run("npm", ["whoami", "--registry", NPM_REGISTRY]);
}

export function installFrozenDependencies() {
	run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], {
		stdio: "inherit",
		env: { NPM_CONFIG_IGNORE_SCRIPTS: "true" },
	});
}

export function assertCleanLatestMain() {
	const branch = run("git", ["branch", "--show-current"]).stdout.trim();
	if (branch !== "main")
		throw new Error(
			`Releases must run from main; found ${branch || "detached HEAD"}`,
		);
	const status = run("git", ["status", "--porcelain"]).stdout.trim();
	if (status) throw new Error(`Working tree is not clean:\n${status}`);

	run("git", ["fetch", "origin", "main"]);
	const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
	const remote = run("git", ["rev-parse", "origin/main"]).stdout.trim();
	if (head !== remote)
		throw new Error(
			`Local main (${head}) does not match origin/main (${remote})`,
		);
	return head;
}

export function assertCleanMain() {
	const branch = run("git", ["branch", "--show-current"]).stdout.trim();
	const status = run("git", ["status", "--porcelain"]).stdout.trim();
	if (branch !== "main" || status)
		throw new Error("Build or tests changed the release working tree");
}

export async function readPackageJson(root = process.cwd()) {
	return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
}

export async function listChangesets(root = process.cwd()) {
	const entries = await readdir(path.join(root, ".changeset"), {
		withFileTypes: true,
	});
	return entries
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith(".md") &&
				entry.name !== "README.md",
		)
		.map((entry) => `.changeset/${entry.name}`)
		.sort();
}

export function parseChangesetStatus(raw, packageName) {
	const status = JSON.parse(raw);
	if (!status.changesets?.length)
		throw new Error("No pending changesets. Run 'pnpm change' first.");
	const release = status.releases?.find((item) => item.name === packageName);
	if (!release?.newVersion)
		throw new Error(
			`Changesets did not calculate a release for ${packageName}`,
		);
	assertStableVersion(release.newVersion);
	return {
		changesetCount: status.changesets.length,
		version: release.newVersion,
	};
}

export function validateReleaseDiff(raw) {
	const entries = raw
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [status, ...paths] = line.split("\t");
			return { status, paths };
		});
	let packageChanged = false;
	let changelogChanged = false;
	const deletedChangesets = [];

	for (const entry of entries) {
		if (entry.paths.length !== 1)
			throw new Error(
				`Renamed files are not allowed: ${entry.paths.join(" -> ")}`,
			);
		const [file] = entry.paths;
		if (file.startsWith(".changeset/")) {
			if (entry.status !== "D" || !file.endsWith(".md")) {
				throw new Error(
					`Unexpected changeset change: ${entry.status}\t${file}`,
				);
			}
			deletedChangesets.push(file);
			continue;
		}
		if (!RELEASE_FILES.has(file) || !entry.status.startsWith("M")) {
			throw new Error(`Unexpected release change: ${entry.status}\t${file}`);
		}
		packageChanged ||= file === "package.json";
		changelogChanged ||= file === "CHANGELOG.md";
	}
	if (!packageChanged || !changelogChanged || deletedChangesets.length === 0) {
		throw new Error(
			"Release diff must update package.json and CHANGELOG.md and delete changesets",
		);
	}
	return { entries, deletedChangesets };
}

export function extractReleaseNotes(changelog, version) {
	const header = new RegExp(
		`^##\\s+\\[?${version.replaceAll(".", "\\.")}\\]?\\s*$`,
	);
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((line) => header.test(line));
	if (start === -1)
		throw new Error(`Version ${version} was not found in CHANGELOG.md`);
	const next = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);
	const notes = lines
		.slice(start + 1, next === -1 ? undefined : next)
		.join("\n")
		.trim();
	if (!notes) throw new Error(`Version ${version} has no release notes`);
	return notes;
}

export function isNpmNotFoundError(error) {
	if (!(error instanceof CommandError)) return false;
	return /(?:^|\n)npm (?:ERR!|error) code E404(?:\n|$)/i.test(
		`${error.stderr}\n${error.stdout}`,
	);
}

export function parseNpmPack(raw) {
	const pack = JSON.parse(raw)?.[0];
	if (!pack?.filename || !pack?.integrity)
		throw new Error("npm pack did not return filename and integrity");
	return { filename: pack.filename, integrity: pack.integrity };
}
