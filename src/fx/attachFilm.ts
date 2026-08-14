/**
 * フィルム処理をカメラに掛ける。画面ごとに同じことを書いていたのでまとめた。
 *
 * ここが「掛からなかった」ときの唯一の入口でもある。掛からない理由は2つあり、
 * どちらも黙って絵が変わらないだけなので、画面に但し書きを出して分かるようにする:
 *
 * - **WebGL が使えない**。Phaser は Canvas での描画に切り替わり、
 *   ポストエフェクトの仕組みそのものが無い（起動時に一度知らせる）
 * - **WebGL はあるのに掛からない**。シェーダの読み込みに失敗した場合など
 */

import Phaser from 'phaser';
import { FilmPipeline } from './FilmPipeline';
import { settings } from '../settings';
import { note } from '../diagnostics';

/**
 * @param level 掛けたあとに設定する強さ。省略するとオプション画面で選んだ強さ
 * @returns 掛かったパイプライン。掛からなければ null
 */
export function attachFilm(scene: Phaser.Scene, level: number = settings.film): FilmPipeline | null {
  const renderer = scene.game.renderer;
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return null;

  if (!renderer.pipelines.has('Film')) renderer.pipelines.addPostPipeline('Film', FilmPipeline);
  scene.cameras.main.setPostPipeline(FilmPipeline);
  const film = scene.cameras.main.getPostPipeline(FilmPipeline) as FilmPipeline | null;
  if (!film) {
    note('フィルム風の効果を掛けられませんでした（WebGL はありますが、'
      + 'ポストエフェクトが載りません）。ブラウザの表示は続きます。');
    return null;
  }
  film.setLevel(level);
  return film;
}
