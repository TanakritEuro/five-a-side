import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works at any URL (e.g. GitHub Pages' /five-a-side/).
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Rapier's compat build inlines its WASM, so the bundle is ~5 MB by design.
    chunkSizeWarningLimit: 6000,
  },
});
