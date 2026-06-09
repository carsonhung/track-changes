import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Host app owns Vue, Tiptap, ProseMirror, and the core package.
  external: ['vue', /^@tiptap\//, /^prosemirror-/, '@tdg-reports/track-changes-core'],
});
