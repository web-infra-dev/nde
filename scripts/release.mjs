#!/usr/bin/env node

import {
	access,
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import {
	CommandError,
	NPM_REGISTRY,
	assertAuthenticatedTools,
	assertCleanLatestMain,
	assertCleanMain,
	assertOnlyPackageVersionChanged,
	assertVersionIncreased,
	extractReleaseNotes,
	installFrozenDependencies,
	isNpmNotFoundError,
	listChangesets,
	parseNpmPack,
	run,
	validateReleaseDiff,
} from "./release-utils.mjs";

function verifyReleaseCommit(commit) {
	const parents = run("git", ["rev-list", "--parents", "-n", "1", commit])
		.stdout.trim()
		.split(/\s+/);
	if (parents.length !== 2)
		throw new Error("The Version PR must be squash merged");

	const packageJson = JSON.parse(
		run("git", ["show", `${commit}:package.json`]).stdout,
	);
	const previousPackage = JSON.parse(
		run("git", ["show", `${commit}^:package.json`]).stdout,
	);
	assertVersionIncreased(previousPackage.version, packageJson.version);
	assertOnlyPackageVersionChanged(previousPackage, packageJson);
	const diff = validateReleaseDiff(
		run("git", ["diff", "--name-status", "-M", `${commit}^`, commit]).stdout,
	);
	const changelog = run("git", ["show", `${commit}:CHANGELOG.md`]).stdout;
	return {
		packageJson,
		version: packageJson.version,
		tagName: `v${packageJson.version}`,
		changesetCount: diff.deletedChangesets.length,
		notes: extractReleaseNotes(changelog, packageJson.version),
	};
}

function repositorySlug(packageJson) {
	const repository =
		typeof packageJson.repository === "string"
			? packageJson.repository
			: packageJson.repository?.url;
	const match = repository?.match(
		/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:\/tree\/[^/]+)?$/,
	);
	if (!match) throw new Error("package.json repository must point to GitHub");
	return match[1];
}

function assertOrigin(slug) {
	const origin = run("git", ["remote", "get-url", "origin"]).stdout.trim();
	const normalizedOrigin = origin
		.replace(/^git@github\.com:/, "https://github.com/")
		.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
	if (normalizedOrigin !== `https://github.com/${slug}`) {
		throw new Error(`origin does not point to ${slug}`);
	}
}

function assertVersionDoesNotExist(packageName, version, tagName, slug) {
	try {
		run("npm", [
			"view",
			`${packageName}@${version}`,
			"version",
			"--registry",
			NPM_REGISTRY,
		]);
		throw new Error(`${packageName}@${version} already exists on npm`);
	} catch (error) {
		if (!isNpmNotFoundError(error)) throw error;
	}

	const localTag =
		run("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tagName}`], {
			allowExitCodes: [0, 1],
		}).status === 0;
	const remoteTag =
		run(
			"git",
			["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tagName}`],
			{ allowExitCodes: [0, 2] },
		).status === 0;
	if (localTag || remoteTag) throw new Error(`Tag ${tagName} already exists`);

	try {
		run("gh", ["api", `repos/${slug}/releases/tags/${tagName}`, "--silent"]);
		throw new Error(`GitHub Release ${tagName} already exists`);
	} catch (error) {
		if (
			!(error instanceof CommandError) ||
			!/HTTP 404/.test(`${error.stderr}\n${error.stdout}`)
		) {
			throw error;
		}
	}
}

export async function buildPackage(root, packageJson) {
	const safeEnv = { NPM_CONFIG_IGNORE_SCRIPTS: "true" };
	run("pnpm", ["exec", "biome", "check", "."], {
		stdio: "inherit",
		env: safeEnv,
	});
	run("pnpm", ["build"], { stdio: "inherit", env: safeEnv });
	run("pnpm", ["test"], { stdio: "inherit", env: safeEnv });
	assertCleanMain();

	const temporaryDirectory = await mkdtemp(
		path.join(os.tmpdir(), "nde-release-"),
	);
	const staging = path.join(temporaryDirectory, "staging");
	const artifacts = path.join(temporaryDirectory, "artifacts");
	const consumer = path.join(temporaryDirectory, "consumer");
	try {
		await Promise.all([mkdir(staging), mkdir(artifacts), mkdir(consumer)]);
		await writeFile(
			path.join(staging, "package.json"),
			`${JSON.stringify(packageJson, null, 2)}\n`,
		);
		await Promise.all([
			cp(path.join(root, "dist"), path.join(staging, "dist"), {
				recursive: true,
			}),
			copyFile(path.join(root, "README.md"), path.join(staging, "README.md")),
			copyFile(path.join(root, "LICENSE"), path.join(staging, "LICENSE")),
		]);
		await Promise.all([
			access(path.join(staging, "dist/index.js")),
			access(path.join(staging, "dist/index.mjs")),
			access(path.join(staging, "dist/index.d.ts")),
		]);

		const pack = parseNpmPack(
			run(
				"npm",
				[
					"pack",
					staging,
					"--ignore-scripts",
					"--json",
					"--pack-destination",
					artifacts,
				],
				{ env: safeEnv },
			).stdout,
		);
		const tarball = path.join(artifacts, pack.filename);
		await writeFile(path.join(consumer, "package.json"), '{"private":true}\n');
		run(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-package-lock",
				"--no-save",
				tarball,
			],
			{ cwd: consumer, stdio: "inherit", env: safeEnv },
		);
		run(
			"node",
			[
				"--eval",
				`const pkg=require(${JSON.stringify(packageJson.name)}); if(typeof pkg.nodeDepEmit!=='function') process.exit(1)`,
			],
			{ cwd: consumer },
		);
		return { ...pack, tarball, temporaryDirectory };
	} catch (error) {
		await rm(temporaryDirectory, { recursive: true, force: true });
		throw error;
	}
}

async function confirmVersion(version) {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error("Publishing requires an interactive terminal");
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answer = await prompt.question(`Type ${version} to publish: `);
		if (answer.trim() !== version) throw new Error("Release cancelled");
	} finally {
		prompt.close();
	}
}

async function release() {
	let pack;
	let publishAttempted = false;
	let npmPublished = false;
	let tagCreated = false;
	let tagPushed = false;
	let releaseInfo;
	try {
		if (process.argv.length > 2)
			throw new Error("release does not accept arguments");
		if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
			throw new Error(
				"Unset NPM_TOKEN and NODE_AUTH_TOKEN; use npm login with 2FA",
			);
		}
		assertAuthenticatedTools({ npm: true });
		const commit = assertCleanLatestMain();
		installFrozenDependencies();
		assertCleanMain();
		releaseInfo = verifyReleaseCommit(commit);
		const pendingChangesets = await listChangesets();
		if (pendingChangesets.length)
			throw new Error("Pending changesets remain on main");

		const { packageJson, version, tagName, changesetCount, notes } =
			releaseInfo;
		const slug = repositorySlug(packageJson);
		assertOrigin(slug);
		assertVersionDoesNotExist(packageJson.name, version, tagName, slug);
		pack = await buildPackage(process.cwd(), packageJson);

		console.log(`Ready to publish ${packageJson.name}@${version}`);
		console.log(`Commit: ${commit}`);
		console.log(`Changesets: ${changesetCount}`);
		console.log(`Tarball integrity: ${pack.integrity}`);
		await confirmVersion(version);
		if (assertCleanLatestMain() !== commit) {
			throw new Error("main changed during release verification");
		}

		publishAttempted = true;
		run(
			"npm",
			[
				"publish",
				pack.tarball,
				"--ignore-scripts",
				"--tag",
				"latest",
				"--registry",
				NPM_REGISTRY,
			],
			{ stdio: "inherit", env: { NPM_CONFIG_IGNORE_SCRIPTS: "true" } },
		);
		npmPublished = true;
		run("git", ["tag", "-a", tagName, commit, "-m", tagName]);
		tagCreated = true;
		run(
			"git",
			["push", "origin", `refs/tags/${tagName}:refs/tags/${tagName}`],
			{
				stdio: "inherit",
			},
		);
		tagPushed = true;
		const notesFile = path.join(pack.temporaryDirectory, "release-notes.md");
		await writeFile(notesFile, `${notes}\n`);
		run(
			"gh",
			[
				"release",
				"create",
				tagName,
				"--verify-tag",
				"--title",
				tagName,
				"--notes-file",
				notesFile,
				"--latest",
				"--repo",
				slug,
			],
			{ stdio: "inherit" },
		);
		console.log(`Release ${tagName} completed.`);
	} catch (error) {
		console.error(`Release failed: ${error.message}`);
		if (publishAttempted && !npmPublished) {
			console.error(
				"npm publish returned an error. Check npm before retrying the release.",
			);
		}
		if (npmPublished && releaseInfo) {
			console.error(
				`npm is already published. Do not publish ${releaseInfo.version} again.`,
			);
			if (tagPushed)
				console.error(`Create GitHub Release ${releaseInfo.tagName} manually.`);
			else if (tagCreated)
				console.error(
					`Push local Tag ${releaseInfo.tagName}, then create its GitHub Release manually.`,
				);
			else
				console.error(
					`Create and push Tag ${releaseInfo.tagName}, then create its GitHub Release manually.`,
				);
		}
		process.exitCode = 1;
	} finally {
		if (pack)
			await rm(pack.temporaryDirectory, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	release();
}
