import { defineConfig } from 'tsup';

export default defineConfig([
  // npm: ESM + CJS with type declarations. The React entry is marked as a client module.
  {
    entry: { index: 'src/index.ts', react: 'src/react.tsx' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'es2020',
    external: ['react'],
    banner: { js: '"use client";' },
  },
  // CDN: a single minified <script> exposing window.CursorCrew.
  {
    entry: { cursorcrew: 'src/index.ts' },
    format: ['iife'],
    globalName: 'CursorCrew',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    outExtension: () => ({ js: '.global.js' }),
  },
]);
