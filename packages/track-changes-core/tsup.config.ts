import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // ProseMirror + Tiptap are peer-owned by the host app (single instance).
  external: [/^@tiptap\//],
});
