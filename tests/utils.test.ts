import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fse from 'fs-extra'
import {
  writePackage,
  linkPackage,
  readDirRecursive,
  isFile,
  findEntryFiles,
  isSubPath,
} from '../src/utils';

vi.mock('fs-extra', () => {
  const actual = vi.importActual('fs-extra');
  return {
    ...actual,
    default: {
      ensureDir: vi.fn(),
      copyFile: vi.fn(),
      writeFile: vi.fn(),
      lstat: vi.fn(),
      mkdir: vi.fn(),
      symlink: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn(),
      stat: vi.fn(),
    },
    ensureDir: vi.fn(),
    copyFile: vi.fn(),
    writeFile: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    symlink: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
  };
});

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('writePackage', () => {
    it('should write and copy files to the specified directory', async () => {
      const options = {
        pkg: {
          name: 'test-package',
          versions: {
            '1.0.0': {
              pkgJSON: { name: 'test-package', version: '1.0.0' },
              path: '/project/test-package',
              isDirectDep: true,
              files: ['/source/file1.js', '/source/file2.js'],
            },
          },
        },
        version: '1.0.0',
        projectDir: '/project',
      };

      await writePackage(options);

      expect(fse.ensureDir).toHaveBeenCalled();
      expect(fse.copyFile).toHaveBeenCalledTimes(2);
      expect(fse.writeFile).toHaveBeenCalledWith(
        path.join('/project', 'node_modules', 'test-package', 'package.json'),
        JSON.stringify({ name: 'test-package', version: '1.0.0' }, null, 2)
      );
    });
  });

  describe('linkPackage', () => {
    it('should create a symlink between modules', async () => {
      vi.mocked(fse.lstat).mockResolvedValueOnce(null as any); // 模拟不存在符号链接的情况
      await linkPackage('from-package', 'to-package', '/project');

      expect(fse.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('/project/node_modules'),
        { recursive: true }
      );
      expect(fse.symlink).toHaveBeenCalled();
    });
  });

  describe('readDirRecursive', () => {
    it('should return all files in a directory recursively', async () => {
      vi.mocked(fse.readdir)
        .mockResolvedValueOnce([
          { name: 'file1.js', isDirectory: () => false },
          { name: 'dir1', isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'file2.js', isDirectory: () => false },
        ] as any);

      const files = await readDirRecursive('/root');
      expect(files).toEqual([
        '/root/file1.js',
        '/root/dir1/file2.js',
      ]);
    });
  });

  describe('isFile', () => {
    it('should return true for files and false for directories', async () => {
      vi.mocked(fse.stat)
        .mockResolvedValueOnce({ isFile: () => true } as any)
        .mockRejectedValueOnce({ code: 'ENOENT' });

      expect(await isFile('/file/path')).toBe(true);
      expect(await isFile('/missing/file/path')).toBe(false);
    });
  });

  describe('findEntryFiles', () => {
    it('should find JavaScript files with specific extensions', async () => {
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'file.mjs', isDirectory: () => false },
        { name: 'file.js', isDirectory: () => false },
        { name: 'file.txt', isDirectory: () => false },
      ] as any);

      const entries = await findEntryFiles('/root');
      expect(entries).toEqual(['/root/file.mjs', '/root/file.js']);
    });
  });

  describe('isSubPath', () => {
    it('should verify if a path is a subpath of another', () => {
      expect(isSubPath('/parent', '/parent/child')).toBe(true);
      expect(isSubPath('/parent', '/parent2/sibling')).toBe(false);
    });
  });
});
