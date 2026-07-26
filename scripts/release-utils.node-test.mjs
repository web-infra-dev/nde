import assert from "node:assert/strict";
import test from "node:test";
import {
	CommandError,
	assertOnlyPackageVersionChanged,
	assertStableVersion,
	assertVersionIncreased,
	extractReleaseNotes,
	isNpmNotFoundError,
	parseChangesetStatus,
	parseNpmPack,
	validateReleaseDiff,
} from "./release-utils.mjs";

test("aggregates multiple changesets into one release", () => {
	const result = parseChangesetStatus(
		JSON.stringify({
			changesets: [{ id: "one" }, { id: "two" }],
			releases: [{ name: "ndepe", newVersion: "0.2.0" }],
		}),
		"ndepe",
	);
	assert.deepEqual(result, { changesetCount: 2, version: "0.2.0" });
});

test("rejects missing changesets and prereleases", () => {
	assert.throws(
		() =>
			parseChangesetStatus(
				JSON.stringify({ changesets: [], releases: [] }),
				"ndepe",
			),
		/No pending changesets/,
	);
	assert.throws(() => assertStableVersion("1.0.0-beta.1"), /stable SemVer/);
});

test("requires the package version to increase", () => {
	assert.doesNotThrow(() => assertVersionIncreased("0.1.13", "0.2.0"));
	assert.throws(
		() => assertVersionIncreased("0.2.0", "0.1.13"),
		/Version must increase/,
	);
});

test("allows only the version field to change in package.json", () => {
	const previous = {
		name: "ndepe",
		version: "0.1.13",
		main: "./dist/index.js",
	};
	assert.doesNotThrow(() =>
		assertOnlyPackageVersionChanged(previous, {
			...previous,
			version: "0.2.0",
		}),
	);
	assert.throws(
		() =>
			assertOnlyPackageVersionChanged(previous, {
				...previous,
				version: "0.2.0",
				name: "wrong-package",
			}),
		/may only change/,
	);
});

test("accepts only release metadata and deleted changesets", () => {
	const diff = [
		"D\t.changeset/one.md",
		"D\t.changeset/two.md",
		"M\tCHANGELOG.md",
		"M\tpackage.json",
	].join("\n");
	assert.equal(validateReleaseDiff(diff).deletedChangesets.length, 2);
	assert.throws(
		() => validateReleaseDiff(`${diff}\nM\tsrc/index.ts`),
		/Unexpected release change/,
	);
});

test("extracts only the current changelog section", () => {
	const changelog = "# ndepe\n\n## 0.2.0\n\n- current\n\n## 0.1.13\n\n- old\n";
	assert.equal(extractReleaseNotes(changelog, "0.2.0"), "- current");
});

test("treats only npm E404 as an absent version", () => {
	const missing = new CommandError("npm view", {
		status: 1,
		stdout: "",
		stderr: "npm error code E404\n",
	});
	const network = new CommandError("npm view", {
		status: 1,
		stdout: "",
		stderr: "npm error code EAI_AGAIN\n",
	});
	assert.equal(isNpmNotFoundError(missing), true);
	assert.equal(isNpmNotFoundError(network), false);
});

test("requires npm pack filename and integrity", () => {
	assert.deepEqual(
		parseNpmPack('[{"filename":"ndepe-0.2.0.tgz","integrity":"sha512-value"}]'),
		{ filename: "ndepe-0.2.0.tgz", integrity: "sha512-value" },
	);
	assert.throws(() => parseNpmPack('[{"filename":"ndepe.tgz"}]'), /integrity/);
});
