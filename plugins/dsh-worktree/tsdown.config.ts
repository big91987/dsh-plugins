import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    clean: true,
    dts: false,
    entry: ['src/index.ts'],
    fixedExtension: false,
    format: ['esm'],
    outDir: 'lib',
    platform: 'node',
    target: 'node22.19.0',
  },
  {
    clean: false,
    dts: false,
    entry: { client: 'src/client/index.ts' },
    fixedExtension: false,
    format: ['cjs'],
    outDir: 'lib',
    outputOptions: {
      banner: 'window.__ModuleLoader__.load({ id: "dsh-worktree", factory: (require) => {',
      entryFileNames: 'client.js',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
    platform: 'browser',
    target: 'es2024',
  },
])
