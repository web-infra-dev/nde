
import { expect, describe, it, afterEach } from 'vitest'
import path from 'node:path'
import fse from 'fs-extra'
import { handleDependencies } from '../src';

describe('handle dependencies', () => {
  const project1Dir = path.join(__dirname, 'fixtures/project1');
  const srcDir = path.join(project1Dir, 'src');
  const outputNodeModulesDir = path.join(srcDir, 'node_modules');
  const ndeDir = path.join(outputNodeModulesDir, '.nde');
  const outputPkgPath = path.join(srcDir, 'package.json');
  afterEach(async () => {
    await fse.remove(outputNodeModulesDir);
    await fse.remove(outputPkgPath);
  })
  it('basic usage', async() => {
    await handleDependencies({
      appDir: project1Dir,
      sourceDir: srcDir,
    })
    const items = await fse.readdir(ndeDir)
    expect(items).toMatchObject([ 'depd@1.1.2', 'depd@2.0.0' ]);
    const pkgJson = await fse.readJSON(outputPkgPath)
    expect(pkgJson).toMatchSnapshot();
  })
})


