/**
 * 素材の読み込みと、染め直したテクスチャの生成。
 *
 * 白煙・火の玉・燃え残り・土煙は、提供イラストの煙を染め直して作る。
 * 別の絵を用意すると絵柄が浮くため。詳細は src/fx/tint.ts を参照。
 */

import Phaser from 'phaser';
import { makeTintedTexture } from '../fx/tint';

const DARK_PUFFS = ['puff-dark-01', 'puff-dark-02', 'puff-dark-03', 'puff-dark-04'];
const LIGHT_PUFFS = ['puff-light-01', 'puff-light-02', 'puff-light-03', 'puff-light-04'];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image('bg-sunset', 'art/bg/stage-sunset.png');
    this.load.image('plane-red', 'art/planes/plane-red.png');
    this.load.image('plane-red-top', 'art/planes/plane-red-top2.png');
    this.load.image('plane-red-under', 'art/planes/plane-red-under2.png');
    this.load.image('plane-blue', 'art/planes/plane-blue.png');
    this.load.image('plane-blue-top', 'art/planes/plane-blue-top2.png');
    this.load.image('plane-blue-under', 'art/planes/plane-blue-under2.png');
    this.load.image('balloon', 'art/props/baloon.png');
    for (const k of DARK_PUFFS) this.load.image(k, `art/smoke/${k}.png`);
    for (const k of LIGHT_PUFFS) this.load.image(k, `art/smoke/${k}.png`);
  }

  create(): void {
    for (const k of DARK_PUFFS) {
      // 通常飛行の白い航跡。薄い煙の絵は元々かすれていて空の上では軌跡として読めないため、
      // 濃い煙の絵を白く起こして使う
      makeTintedTexture(this, `${k}-white`, k, { color: '#ffffff', amount: 0.88 });
      makeTintedTexture(this, `${k}-fire`, k, { color: '#ef5f08', amount: 0.96, lift: 0.2, round: true, dense: 4, ink: 0.3 });
      makeTintedTexture(this, `${k}-core`, k, { color: '#ffc23a', amount: 0.95, lift: 0.55, round: true, dense: 4, ink: 0.28 });
      makeTintedTexture(this, `${k}-ember`, k, { color: '#a83518', amount: 0.9, round: true, dense: 2, ink: 0.35 });
      makeTintedTexture(this, `${k}-dust`, k, { color: '#a9854f', amount: 0.85, lift: 0.12, round: true, ink: 0.3 });
      makeTintedTexture(this, `${k}-bsmoke`, k, { color: '#3a332b', amount: 0.35, round: true });
    }
    this.scene.start('Play');
  }
}
