import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Single-source the runtime VERSION from package.json (no drift).
  define: { __TC_VERSION__: JSON.stringify(version) },
  // Host app owns Vue, Tiptap, ProseMirror, and the core package.
  external: ['vue', /^@tiptap\//, /^prosemirror-/, 'track-changes-core'],
});
