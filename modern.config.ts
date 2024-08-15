import { moduleTools, defineConfig } from '@modern-js/module-tools';

export default defineConfig({
  plugins: [moduleTools()],
  buildConfig: [
    {
      format: 'cjs',
      target: 'es2021',
      buildType: 'bundleless',
      outDir: './dist/cjs',
    },
    {
      format: 'esm',
      target: 'es2021',
      buildType: 'bundleless',
      outDir: './dist/esm',
    }
  ],
});
