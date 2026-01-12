
import { expect, describe, it, afterEach } from 'vitest'
import path from 'node:path'
import fse from 'fs-extra'
import { nodeDepEmit } from '../src';

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


