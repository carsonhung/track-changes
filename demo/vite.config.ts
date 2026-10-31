import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/; the workflow sets DEMO_BASE.
  base: process.env.DEMO_BASE ?? '/',
});
