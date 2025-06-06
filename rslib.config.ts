import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      bundle: false,
      syntax: 'es2021',
      dts: true,
    },
    {
      format: 'cjs',
      bundle: false,
      syntax: 'es2021',
    },
  ],
});
