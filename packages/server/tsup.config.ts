import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cli.ts',
    'src/security.ts',
    'src/integrations/nextjs.ts',
    'src/integrations/express.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: ['better-sqlite3', 'express'],
})
