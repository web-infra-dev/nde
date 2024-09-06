import path from "node:path";
import type { NodeFileTraceOptions } from "@vercel/nft";
import fse from "fs-extra";
import { parseNodeModulePath } from "mlly";
import type { PackageJson } from "pkg-types";
import { readPackageJSON } from "pkg-types";
import pkgUp from "pkg-up";
import semver from "semver";

import {
	type CacheOptions,
	type TracedFile,
	type TracedPackage,
	traceFiles as defaultTraceFiles,
	findEntryFiles,
	findPackageParents,
	isFile,
	isSubPath,
	linkPackage,
	readDirRecursive,
	resolveTracedPath,
	writePackage,
} from "./utils";
import { debug } from "./utils";

export type { NodeFileTraceOptions } from "@vercel/nft";
export { nodeFileTrace } from "@vercel/nft";

export const nodeDepEmit = async ({
	appDir,
	sourceDir,
	includeEntries,
	traceFiles = defaultTraceFiles,
	entryFilter,
	modifyPackageJson,
	copyWholePackage,
	cacheOptions = {
		cacheDir: ".modern-js/deploy",
		analysisCache: false,
		fileCache: false,
		symlinkCache: false,
	},
	traceOptions,
}: {
	/**
	 * Directory of the project
	 */
	appDir: string;
	/**
	 * The directory where the code will be analyzed, all js files in that directory will be used as entries, and the node_modules directory will be generated in that directory
	 */
	sourceDir: string;
	/**
	 * Some files to include, generally some files not analyzed by the code
	 */
	includeEntries?: string[];
	traceFiles?: typeof defaultTraceFiles;
	entryFilter?: (filePath: string) => boolean;
	modifyPackageJson?: (pkgJson: PackageJson) => PackageJson;
	copyWholePackage?: (pkgName: string, pkgJSON: PackageJson) => boolean;
	cacheOptions?: CacheOptions;
	traceOptions?: NodeFileTraceOptions;
}) => {
	const base = "/";
	const entryFiles = await findEntryFiles(sourceDir, entryFilter);

	debug("trace files start");
	const fileTrace = await traceFiles({
		entryFiles: entryFiles.concat(includeEntries || []),
		sourceDir,
		cacheOptions: {
			...cacheOptions,
			cacheDir: path.resolve(appDir, cacheOptions.cacheDir),
		},
		base,
		traceOptions,
	});
	debug("trace files end");
	const currentProjectModules = path.join(appDir, "node_modules");
	// Because vercel/nft may find inaccurately, we limit the range of query of dependencies
	const dependencySearchRoot = path.resolve(appDir, "../../../../../../");

	const tracedFiles: Record<string, TracedFile> = Object.fromEntries(
		(await Promise.all(
			[...fileTrace.reasons.entries()].map(async ([_path, reasons]) => {
				if (reasons.ignored) {
					return;
				}
				const filePath = await resolveTracedPath(base, _path);

				if (
					isSubPath(sourceDir, filePath) ||
					(isSubPath(appDir, filePath) &&
						!isSubPath(currentProjectModules, filePath))
				) {
					return;
				}

				if (!(await isFile(filePath))) {
					return;
				}

				let baseDir: string | undefined;
				let pkgName: string | undefined;
				let subpath: string | undefined;
				let pkgPath: string | undefined;

				if (filePath.includes("node_modules")) {
					const parsed = parseNodeModulePath(filePath);
					baseDir = parsed.dir;
					pkgName = parsed.name;
					subpath = parsed.subpath;
					// biome-ignore lint/style/noNonNullAssertion: <explanation>
					pkgPath = path.join(baseDir!, pkgName!);
				} else {
					// For @modern-js/utils, since there are some pre-bundled packages in the package that have their own package.json,
					// and since the relationship between these files uses relative paths, some special handling is required
					const MODERN_UTILS_PATH = "packages/toolkit/utils";
					const MODERN_UTILS_PATH_REGEX = new RegExp(
						`(.*${MODERN_UTILS_PATH})`,
					);
					const match = filePath.match(MODERN_UTILS_PATH_REGEX);

					const packageJsonPath: string | null = match
						? path.join(match[0], "package.json")
						: await pkgUp({ cwd: path.dirname(filePath) });

					if (
						packageJsonPath &&
						isSubPath(dependencySearchRoot, packageJsonPath)
					) {
						const packageJson: PackageJson =
							await fse.readJSON(packageJsonPath);

						pkgPath = baseDir = path.dirname(packageJsonPath);
						subpath = path.relative(baseDir, filePath);
						pkgName = packageJson.name;
					}
				}

				if (!baseDir) {
					return;
				}

				const parents = await Promise.all(
					[...reasons.parents].map((p) => resolveTracedPath(base, p)),
				);
				const tracedFile = {
					path: filePath,
					parents,
					isDirectDep: parents.some((parent) => {
						return (
							isSubPath(appDir, parent) &&
							!isSubPath(currentProjectModules, parent)
						);
					}),

					subpath,
					pkgName,
					pkgPath,
				} as TracedFile;

				return [filePath, tracedFile];
			}),
		).then((r) => r.filter(Boolean))) as [string, TracedFile][],
	);

	const tracedPackages: Record<string, TracedPackage> = {};
	for (const tracedFile of Object.values(tracedFiles)) {
		const { pkgName } = tracedFile;
		let tracedPackage = tracedPackages[pkgName];

		let pkgJSON = await readPackageJSON(tracedFile.pkgPath, {
			cache: true,
		}).catch(() => {});
		if (!pkgJSON) {
			pkgJSON = { name: pkgName, version: "0.0.0" } as PackageJson;
		}
		if (!tracedPackage) {
			tracedPackage = {
				name: pkgName,
				versions: {},
			};
			tracedPackages[pkgName] = tracedPackage;
		}

		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		let tracedPackageVersion = tracedPackage.versions[pkgJSON.version!];
		if (!tracedPackageVersion) {
			tracedPackageVersion = {
				path: tracedFile.pkgPath,
				files: [],
				isDirectDep: false,
				pkgJSON,
			};
			if (tracedFile.isDirectDep) {
				tracedPackageVersion.isDirectDep = tracedFile.isDirectDep;
			}
			// biome-ignore lint/style/noNonNullAssertion: <explanation>
			tracedPackage.versions[pkgJSON.version!] = tracedPackageVersion;
		}

		tracedFile.pkgName = pkgName;
		tracedFile.pkgVersion = pkgJSON.version;

		const shouldCopyWholePackage = copyWholePackage?.(pkgName, pkgJSON);
		if (
			tracedFile.path.startsWith(tracedFile.pkgPath) &&
			// Merged package files are based on the version, not on paths, to handle some boundary cases
			tracedPackageVersion.pkgJSON.version === tracedFile.pkgVersion
		) {
			if (shouldCopyWholePackage) {
				const allFiles = await readDirRecursive(tracedFile.pkgPath);
				tracedPackageVersion.files.push(...allFiles);
			} else {
				tracedPackageVersion.files.push(tracedFile.path);
			}
		}
	}

	const multiVersionPkgs: Record<string, { [version: string]: string[] }> = {};
	const singleVersionPackages: string[] = [];
	for (const tracedPackage of Object.values(tracedPackages)) {
		const versions = Object.keys(tracedPackage.versions);
		if (versions.length === 1) {
			singleVersionPackages.push(tracedPackage.name);
			continue;
		}
		multiVersionPkgs[tracedPackage.name] = {};
		for (const version of versions) {
			// biome-ignore lint/style/noNonNullAssertion: <explanation>
			multiVersionPkgs[tracedPackage.name!][version!] = findPackageParents(
				tracedPackage,
				version,
				tracedFiles,
			);
		}
	}

	await Promise.all(
		singleVersionPackages.map((pkgName) => {
			const pkg = tracedPackages[pkgName];
			const version = Object.keys(pkg.versions)[0];
			return writePackage({
				pkg,
				version,
				projectDir: sourceDir,
			});
		}),
	);

	const projectPkgJson = await readPackageJSON(sourceDir).catch(
		() => ({}) as PackageJson,
	);

	for (const [pkgName, pkgVersions] of Object.entries(multiVersionPkgs)) {
		const versionEntires = Object.entries(pkgVersions).sort(
			([v1, p1], [v2, p2]) => {
				const shouldHoist1 =
					tracedPackages[pkgName]?.versions?.[v1]?.isDirectDep;
				const shouldHoist2 =
					tracedPackages[pkgName]?.versions?.[v2]?.isDirectDep;

				if (shouldHoist1 && !shouldHoist2) {
					return -1;
				}
				if (!shouldHoist1 && shouldHoist2) {
					return 1;
				}
				if (p1.length === 0) {
					return -1;
				}
				if (p2.length === 0) {
					return 1;
				}

				return semver.lt(v1, v2, { loose: true }) ? 1 : -1;
			},
		);

		for (const [version, parentPkgs] of versionEntires) {
			const pkg = tracedPackages[pkgName];

			const pkgDestPath = `.ndepe/${pkgName}@${version}/node_modules/${pkgName}`;
			await writePackage({
				pkg,
				version,
				projectDir: sourceDir,
				_pkgPath: pkgDestPath,
			});
			await linkPackage(pkgDestPath, `${pkgName}`, sourceDir);

			for (const parentPkg of parentPkgs) {
				const parentPkgName = parentPkg.replace(/@[^@]+$/, "");
				await (multiVersionPkgs[parentPkgName]
					? linkPackage(
							pkgDestPath,
							`.ndepe/${parentPkg}/node_modules/${pkgName}`,
							sourceDir,
						)
					: linkPackage(
							pkgDestPath,
							`${parentPkgName}/node_modules/${pkgName}`,
							sourceDir,
						));
			}
		}
	}

	const outputPkgPath = path.join(sourceDir, "package.json");

	const newPkgJson = {
		name: `${projectPkgJson.name || "modernjs-project"}-prod`,
		version: projectPkgJson.version || "0.0.0",
		private: true,
		dependencies: Object.fromEntries(
			[
				...Object.values(tracedPackages).map((pkg) => [
					pkg.name,
					Object.keys(pkg.versions)[0],
				]),
			].sort(([a], [b]) => a.localeCompare(b)),
		),
	};

	const finalPkgJson = modifyPackageJson?.(newPkgJson) || newPkgJson;

	await fse.writeJSON(outputPkgPath, finalPkgJson);
	debug("nodeDepEmit finish");
};
