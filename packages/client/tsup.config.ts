import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/adapters.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
  },
  {
    entry: { snapfeed: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Snapfeed',
    sourcemap: true,
    minify: true,
    treeshake: true,
    platform: 'browser',
  },
])
