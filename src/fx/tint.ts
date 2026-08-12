/**
 * 煙の絵を染め直して、白煙・火の玉・燃え残り・土煙のテクスチャを作る。
 *
 * 別の絵を用意すると絵柄が浮くため、提供イラストの煙をそのまま流用する。
 * ただし色を乗せるとインクの輪郭線まで同じ色になってしまうので、
 * 元絵を掛け合わせて線の濃さだけ戻している。
 */

import type Phaser from 'phaser';

export interface TintOptions {
  color: string;
  /** 色を乗せる強さ */
  amount: number;
  /** 明るく持ち上げる量。火のように白熱した色を作るときに使う */
  lift?: number;
  /** 外周を透明に落として丸くする。明るい粒は切り抜きの正方形が見えてしまうため */
  round?: boolean;
  /** 元絵を重ねて描く回数。多いほど濃くなる。火は薄いと空に負ける */
  dense?: number;
  /** 元絵を掛け合わせて輪郭線を戻す強さ */
  ink?: number;
}

/** 染めた canvas を作って Phaser のテクスチャとして登録する */
export function makeTintedTexture(
  scene: Phaser.Scene,
  key: string,
  sourceKey: string,
  opts: TintOptions,
): void {
  if (scene.textures.exists(key)) return;

  const src = scene.textures.get(sourceKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width;
  const h = src.height;

  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();

  for (let i = 0; i < (opts.dense ?? 1); i++) ctx.drawImage(src, 0, 0, w, h);

  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = opts.amount;
  ctx.fillStyle = opts.color;
  ctx.fillRect(0, 0, w, h);

  if (opts.lift) {
    ctx.globalAlpha = opts.lift;
    ctx.fillStyle = '#ffdf9c';
    ctx.fillRect(0, 0, w, h);
  }

  if (opts.ink) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = opts.ink;
    ctx.drawImage(src, 0, 0, w, h);
  }

  if (opts.round) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.72, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  tex.refresh();
}
