import { resolve } from 'node:path'
import { defineConfig } from 'tsup'

const erDiagramRoot = resolve(import.meta.dirname, '../../src/lib/er-diagram')

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node'
  },
  external: ['@modelcontextprotocol/sdk', 'node-sql-parser', 'zod'],
  esbuildOptions(options) {
    options.alias = {
      $er: erDiagramRoot
    }
  }
})
