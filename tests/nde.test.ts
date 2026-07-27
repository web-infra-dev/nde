
import { expect, describe, it, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { NodeFileTraceResult } from '@vercel/nft';
import fse from 'fs-extra'
import { nodeDepEmit } from '../src';
import { traceFiles as defaultTraceFiles } from '../src/utils';

const emptyTraceResult: NodeFileTraceResult = {
  fileList: new Set(),
  esmFileList: new Set(),
  warnings: new Set(),
  reasons: new Map(),
};

const withTempDir = async (
  run: (tempDir: string) => Promise<void>,
): Promise<void> => {
  const tempDir = await fse.realpath(
    await fse.mkdtemp(path.join(os.tmpdir(), 'nde-trace-root-')),
  );
  try {
    await run(tempDir);
  } finally {
    await fse.remove(tempDir);
  }
};

describe('handle dependencies', () => {
  const project1Dir = path.join(__dirname, 'fixtures/project1');
  const srcDir = path.join(project1Dir, 'src');
  const outputNodeModulesDir = path.join(srcDir, 'node_modules');
  const ndeDir = path.join(outputNodeModulesDir, '.ndepe');
  const outputPkgPath = path.join(srcDir, 'package.json');
  afterEach(async () => {
    await fse.remove(outputNodeModulesDir);
    await fse.remove(outputPkgPath);
  })
  it('basic usage', async() => {
    await nodeDepEmit({
      appDir: project1Dir,
      sourceDir: srcDir,
    })
    const items = await fse.readdir(ndeDir)
    expect(items).toMatchObject([ 'depd@1.1.2', 'depd@2.0.0' ]);
    const pkgJson = await fse.readJSON(outputPkgPath)
    expect(pkgJson).toMatchSnapshot();
  })
})

describe('handle workspace packages with directory entry points', () => {
  const project2Dir = path.join(__dirname, 'fixtures/project2');
  const srcDir = path.join(project2Dir, 'src');
  const outputNodeModulesDir = path.join(srcDir, 'node_modules');
  const outputPkgPath = path.join(srcDir, 'package.json');

  afterEach(async () => {
    await fse.remove(outputNodeModulesDir);
    await fse.remove(outputPkgPath);
  })

  it('should handle package.json without name field (directory entry points)', async () => {
    // This test reproduces the bug where a package.json without a "name" field
    // (used for directory entry points) causes a TypeError because path.join receives undefined
    await expect(nodeDepEmit({
      appDir: project2Dir,
      sourceDir: srcDir,
    })).resolves.not.toThrow();

    // Verify the output package.json was created
    const pkgJsonExists = await fse.pathExists(outputPkgPath);
    expect(pkgJsonExists).toBe(true);
  })
})

describe('trace root', () => {
  it('supports default, empty, relative, and absolute trace roots', async () => {
    await withTempDir(async tempDir => {
      const appDir = path.join(tempDir, 'app');
      const sourceDir = path.join(appDir, 'dist');
      const tracedBases: string[] = [];
      await fse.outputFile(
        path.join(sourceDir, 'index.js'),
        'module.exports = 1;',
      );

      for (const traceRoot of [undefined, '', tempDir]) {
        await nodeDepEmit({
          appDir,
          sourceDir,
          traceRoot,
          traceFiles: async options => {
            tracedBases.push(options.base || '');
            return emptyTraceResult;
          },
        });
      }

      expect(tracedBases).toEqual(['/', appDir, tempDir]);
    });
  });

  it('uses the same relative trace root for tracing and dependency copying', async () => {
    await withTempDir(async traceRoot => {
      const appDir = path.join(traceRoot, 'apps/app');
      const sourceDir = path.join(appDir, 'dist');
      const dependencyDir = path.join(traceRoot, 'node_modules/test-dependency');
      let tracedBase: string | undefined;

      await fse.outputJSON(path.join(dependencyDir, 'package.json'), {
        name: 'test-dependency',
        version: '1.0.0',
        main: 'index.js',
      });
      await fse.outputFile(
        path.join(dependencyDir, 'index.js'),
        'module.exports = "test";',
      );
      await fse.outputFile(
        path.join(sourceDir, 'index.js'),
        'module.exports = require("test-dependency");',
      );

      await nodeDepEmit({
        appDir,
        sourceDir,
        traceRoot: '../..',
        traceFiles: async options => {
          tracedBase = options.base;
          return defaultTraceFiles(options);
        },
      });

      expect(tracedBase).toBe(traceRoot);
      await expect(
        fse.readFile(
          path.join(sourceDir, 'node_modules/test-dependency/index.js'),
          'utf8',
        ),
      ).resolves.toBe('module.exports = "test";');
    });
  });

  it('rejects source directories and include entries outside the trace root', async () => {
    await withTempDir(async tempDir => {
      const appDir = path.join(tempDir, 'app');
      const sourceDir = path.join(appDir, 'dist');
      const missingSourceDir = path.join(tempDir, 'missing-source');
      const outsideEntry = path.join(tempDir, 'outside.js');
      const traceFiles = async () => {
        throw new Error('traceFiles should not be called');
      };

      await fse.ensureDir(appDir);
      await expect(
        nodeDepEmit({
          appDir,
          sourceDir: missingSourceDir,
          traceRoot: '',
          traceFiles,
        }),
      ).rejects.toThrow(
        `The trace root "${appDir}" must contain sourceDir "${missingSourceDir}".`,
      );

      await fse.outputFile(
        path.join(sourceDir, 'index.js'),
        'module.exports = 1;',
      );
      await fse.outputFile(outsideEntry, 'module.exports = 2;');

      await expect(
        nodeDepEmit({
          appDir,
          sourceDir,
          traceRoot: '',
          includeEntries: [outsideEntry],
          traceFiles,
        }),
      ).rejects.toThrow(
        `The trace root "${appDir}" must contain every entry file. Outside entries:\n- "${outsideEntry}"`,
      );
    });
  });

});
