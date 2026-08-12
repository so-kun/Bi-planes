import { defineConfig } from 'vite';

// assets/ をそのまま配信する。ゲーム内のパスは 'art/...' になる
export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});
