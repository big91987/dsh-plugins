import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: false,
  entry: ['src/index.ts'],
  fixedExtension: false,
  format: ['esm'],
  outDir: 'lib',
  platform: 'node',
  target: 'node22.19.0',
})
