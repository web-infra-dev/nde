import os from 'node:os';
import path from 'node:path';
import { type NodeFileTraceOptions, nodeFileTrace } from '@vercel/nft';
import createDebug from 'debug';
import fse from 'fs-extra';
import { parseNodeModulePath } from 'mlly';
import type { PackageJson } from 'pkg-types';

export const debug = createDebug('nde');

export type TracedPackage = {
  name: string;
  versions: Record<
    string,
    {
      pkgJSON: PackageJson;
      path: string;
      isDirectDep: boolean;
      files: string[];
    }
  >;
};

export type TracedFile = {
  path: string;
  subpath: string;
  parents: string[];
  isDirectDep: boolean;

  pkgPath: string;
  pkgName: string;
  pkgVersion?: string;
};

function applyPublicCondition(pkg: PackageJson) {
  if (pkg?.publishConfig?.exports) {
    pkg.exports = pkg?.publishConfig?.exports;
  }
}

interface WritePackageOptions {
  pkg: TracedPackage;
  version: string;
  projectDir: string;
  _pkgPath?: string;
}

export const writePackage = async (options: WritePackageOptions) => {
  const { pkg, version, projectDir, _pkgPath } = options;
  const pkgPath = _pkgPath || pkg.name;
  for (const src of pkg.versions[version].files) {
    if (src.includes('node_modules')) {
      const { subpath } = parseNodeModulePath(src);
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const dest = path.join(projectDir, 'node_modules', pkgPath, subpath!);
      const dirname = path.dirname(dest);
      await fse.ensureDir(dirname);
      await fse.copyFile(src, dest);
    } else {
      // workspace package
      const subpath = path.relative(pkg.versions[version].path, src);
      const dest = path.join(projectDir, 'node_modules', pkgPath, subpath);
      const dirname = path.dirname(dest);
      await fse.ensureDir(dirname);
      await fse.copyFile(src, dest);
    }
  }

  const { pkgJSON } = pkg.versions[version];
  applyPublicCondition(pkgJSON);

  const packageJsonPath = path.join(
    projectDir,
    'node_modules',
    pkgPath,
    'package.json',
  );
  await fse.ensureDir(path.dirname(packageJsonPath));
  await fse.writeFile(packageJsonPath, JSON.stringify(pkgJSON, null, 2));
};

const isWindows = os.platform() === 'win32';
export const linkPackage = async (
  from: string,
  to: string,
  projectRootDir: string,
) => {
  const src = path.join(projectRootDir, 'node_modules', from);
  const dest = path.join(projectRootDir, 'node_modules', to);
  const dstStat = await fse.lstat(dest).catch(() => null);
  const exists = dstStat?.isSymbolicLink();

  if (exists) {
    return;
  }
  await fse.mkdir(path.dirname(dest), { recursive: true });
  await fse
    .symlink(
      path.relative(path.dirname(dest), src),
      dest,
      isWindows ? 'junction' : 'dir',
    )
    .catch(error => {
      console.error('Cannot link', from, 'to', to, error);
    });
};

interface ReadDirOptions {
  filter?: (filePath: string) => boolean;
}

export const readDirRecursive = async (
  dir: string,
  options: ReadDirOptions = {},
): Promise<string[]> => {
  const { filter } = options;
  const files = await fse.readdir(dir, { withFileTypes: true });
  const filesAndDirs = await Promise.all(
    files.map(async file => {
      const resolvedPath = path.resolve(dir, file.name);
      if (file.isDirectory()) {
        return readDirRecursive(resolvedPath, options);
      }
      return filter && !filter(resolvedPath) ? [] : resolvedPath;
    }),
  );
  return filesAndDirs.flat();
};

export const isFile = async (file: string) => {
  try {
    const stat = await fse.stat(file);
    return stat.isFile();
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

export const findEntryFiles = async (
  rootDir: string,
  entryFilter?: (filePath: string) => boolean,
) => {
  const files = await readDirRecursive(rootDir, { filter: entryFilter });
  return files.filter(
    file =>
      file.endsWith('.mjs') || file.endsWith('.cjs') || file.endsWith('.js'),
  );
};

export const findPackageParents = (
  pkg: TracedPackage,
  version: string,
  tracedFiles: Record<string, TracedFile>,
) => {
  const versionFiles: TracedFile[] = pkg.versions[version].files.map(
    path => tracedFiles[path],
  );

  const parentPkgs = [
    ...new Set(
      versionFiles.flatMap(file =>
        // Because it supports copyWholePackage configuration, not all files exist.
        file?.parents
          .map(parentPath => {
            const parentFile = tracedFiles[parentPath];

            // when parent does not exist, parent may be an entry file.
            if (!parentFile || parentFile.pkgName === pkg.name) {
              return null;
            }
            return `${parentFile.pkgName}@${parentFile.pkgVersion}`;
          })
          .filter(Boolean),
      ),
    ),
  ];
  return parentPkgs.filter(parentPkg => parentPkg) as string[];
};

async function serializeMap(map: Map<string, unknown>): Promise<string> {
  const resolvedMap = new Map<string, unknown>();

  // Resolve all promises in the map
  await Promise.all(
    Array.from(map.entries()).map(async ([key, value]) => {
      resolvedMap.set(
        key,
        value instanceof Promise ? await Promise.resolve(value) : value,
      );
    }),
  );

  return JSON.stringify(resolvedMap, (key, value) => {
    if (value === null) {
      return undefined;
    }
    if (value instanceof Map) {
      return {
        dataType: 'Map',
        value: Array.from(value.entries()),
      };
    }
    if (value instanceof Set) {
      return {
        dataType: 'Set',
        value: Array.from(value),
      };
    }
    return value;
  });
}

// Function to deserialize a Map with Set values
function deserializeMap(serializedData: string) {
  return JSON.parse(serializedData, (key, value) => {
    if (value && value.dataType === 'Map') {
      return new Map(value.value);
    }
    if (value && value.dataType === 'Set') {
      return new Set(value.value);
    }
    return value;
  });
}

export interface CacheOptions {
  fileCache: boolean;
  analysisCache: boolean;
  symlinkCache: boolean;
  cacheDir: string;
}

const loadCache = async (filePath: string, enabled: boolean) => {
  if (enabled && (await fse.pathExists(filePath))) {
    debug('load cache:', filePath);
    const data = (await fse.readFile(filePath)).toString();
    return deserializeMap(data);
  }
  return undefined;
};

const writeCache = async (filePath: string, cacheMap: Map<string, unknown>) => {
  const newCacheMap = new Map();
  for (const [key, value] of cacheMap.entries()) {
    if (key.includes('node_modules/')) {
      newCacheMap.set(key, value);
    }
  }
  await fse.writeFile(filePath, await serializeMap(newCacheMap));
  console.log(`write ${path.basename(filePath)} finish`);
};

export const traceFiles = async ({
  entryFiles,
  sourceDir,
  base = '/',
  cacheOptions,
  traceOptions,
}: {
  entryFiles: string[];
  sourceDir: string;
  base?: string;
  cacheOptions: CacheOptions;
  traceOptions?: NodeFileTraceOptions;
}) => {
  const { cacheDir, fileCache, analysisCache, symlinkCache } = cacheOptions;
  const analysisCacheFile = path.join(cacheDir, 'analysis-cache.json');
  const fileCacheFile = path.join(cacheDir, 'file-cache.json');
  const symlinkCacheFile = path.join(cacheDir, 'symlink-cache.json');

  const cache = {
    analysisCache: await loadCache(analysisCacheFile, analysisCache),
    fileCache: await loadCache(fileCacheFile, fileCache),
    symlinkCache: await loadCache(symlinkCacheFile, symlinkCache),
  };

  const res = await nodeFileTrace(entryFiles, {
    base,
    processCwd: sourceDir,
    cache,
    ...traceOptions,
  });

  if (analysisCache || fileCache || symlinkCache) {
    await fse.ensureDir(cacheDir);
    if (cache.analysisCache && analysisCache) {
      writeCache(analysisCacheFile, cache.analysisCache);
    }
    if (cache.fileCache && fileCache) {
      writeCache(fileCacheFile, cache.fileCache);
    }
    if (cache.symlinkCache && symlinkCache) {
      writeCache(symlinkCacheFile, cache.symlinkCache);
    }
  }

  return res;
};

export const resolveTracedPath = async (
  base: string,
  p: string,
): Promise<string> => fse.realpath(path.resolve(base, p));

export const isSubPath = (parentPath: string, childPath: string) => {
  if (!parentPath || !childPath) {
    return false;
  }

  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith('..');
};
