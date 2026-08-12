import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * 原本は assets/art/original/ に置いてあるが、実行時には一切使わない（34MB ある）。
 * publicDir はまるごとコピーされるので、ビルド後に取り除く。
 */
function dropOriginals(): Plugin {
  return {
    name: 'drop-originals',
    apply: 'build',
    async closeBundle() {
      await rm(resolve(__dirname, 'dist/art/original'), { recursive: true, force: true });
    },
  };
}

// assets/ をそのまま配信する。ゲーム内のパスは 'art/...' になる
export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: { outDir: 'dist', assetsInlineLimit: 0 },
  plugins: [dropOriginals()],
});
