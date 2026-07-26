#!/usr/bin/env node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	assertAuthenticatedTools,
	assertCleanLatestMain,
	assertCleanMain,
	installFrozenDependencies,
	parseChangesetStatus,
	readPackageJson,
	run,
	validateReleaseDiff,
} from "./release-utils.mjs";

function branchExists(branchName) {
	const local =
		run(
			"git",
			["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
			{
				allowExitCodes: [0, 1],
			},
		).status === 0;
	const remote =
		run(
			"git",
			[
				"ls-remote",
				"--exit-code",
				"--heads",
				"origin",
				`refs/heads/${branchName}`,
			],
			{ allowExitCodes: [0, 2] },
		).status === 0;
	return local || remote;
}

async function prepareRelease() {
	let branchName;
	let pushed = false;
	const temporaryDirectory = await mkdtemp(
		path.join(os.tmpdir(), "nde-release-prepare-"),
	);

	try {
		if (process.argv.length > 2)
			throw new Error("release:prepare does not accept arguments");
		assertAuthenticatedTools();
		assertCleanLatestMain();
		installFrozenDependencies();
		assertCleanMain();
		const packageJson = await readPackageJson();
		const statusFile = path.join(temporaryDirectory, "changeset-status.json");
		run("pnpm", ["exec", "changeset", "status", "--output", statusFile]);
		const { version, changesetCount } = parseChangesetStatus(
			await readFile(statusFile, "utf8"),
			packageJson.name,
		);
		const tagName = `v${version}`;
		branchName = `release/${tagName}`;
		if (branchExists(branchName))
			throw new Error(`Release branch ${branchName} already exists`);

		console.log(
			`Preparing ${packageJson.name}@${version} from ${changesetCount} changeset(s).`,
		);
		run("git", ["switch", "-c", branchName], { stdio: "inherit" });
		run("pnpm", ["exec", "changeset", "version"], { stdio: "inherit" });

		const versionedPackage = await readPackageJson();
		if (versionedPackage.version !== version) {
			throw new Error(
				`Expected version ${version}, found ${versionedPackage.version}`,
			);
		}
		const validated = validateReleaseDiff(
			run("git", ["diff", "--name-status", "-M", "HEAD"]).stdout,
		);
		if (validated.deletedChangesets.length !== changesetCount) {
			throw new Error(`Expected ${changesetCount} deleted changesets`);
		}
		const changedFiles = validated.entries.flatMap((entry) => entry.paths);
		run("git", ["add", "--", ...changedFiles]);
		const leftovers = [
			run("git", ["diff", "--name-only"]).stdout.trim(),
			run("git", ["ls-files", "--others", "--exclude-standard"]).stdout.trim(),
		].filter(Boolean);
		if (leftovers.length)
			throw new Error(`Unexpected release files:\n${leftovers.join("\n")}`);

		const title = `chore: release ${tagName}`;
		run("git", ["commit", "-m", title], { stdio: "inherit" });
		run("git", ["push", "origin", `HEAD:refs/heads/${branchName}`], {
			stdio: "inherit",
		});
		pushed = true;
		const body = [
			`## Release ${tagName}`,
			"",
			`Aggregates ${changesetCount} pending changeset(s).`,
			"",
			"- [ ] Version and changelog are correct",
			"- [ ] Only release metadata changed",
			"- [ ] CI passes",
			"- [ ] Merge with Squash Merge",
		].join("\n");
		run(
			"gh",
			[
				"pr",
				"create",
				"--base",
				"main",
				"--head",
				branchName,
				"--title",
				title,
				"--body",
				body,
			],
			{ stdio: "inherit" },
		);
		console.log(`Version PR created for ${tagName}.`);
	} catch (error) {
		console.error(`Release preparation failed: ${error.message}`);
		if (pushed) {
			console.error(
				`The branch ${branchName} was pushed. Create its PR manually with gh pr create.`,
			);
		} else if (branchName) {
			console.error(
				`The local branch ${branchName} was preserved for inspection.`,
			);
		}
		process.exitCode = 1;
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

prepareRelease();
