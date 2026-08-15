/**
 * 素材の読み込みと、染め直したテクスチャの生成。
 *
 * 白煙・火の玉・燃え残り・土煙は、提供イラストの煙を染め直して作る。
 * 別の絵を用意すると絵柄が浮くため。詳細は src/fx/tint.ts を参照。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';
import { note } from '../diagnostics';
import { makeTintedTexture } from '../fx/tint';

const DARK_PUFFS = ['puff-dark-01', 'puff-dark-02', 'puff-dark-03', 'puff-dark-04'];
const LIGHT_PUFFS = ['puff-light-01', 'puff-light-02', 'puff-light-03', 'puff-light-04'];

export class BootScene extends Phaser.Scene {
  /** 読めなかった絵。1枚でもあれば、その旨を画面に出す */
  private missing: string[] = [];

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.missing = [];
    this.showProgress();
    // 読めなかった絵は、そのまま進むと緑の四角で出るだけで理由が分からない。
    // 集めておいて、あとで画面に出す（読めた絵だけで遊べるので、止めはしない）
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.missing.push(file.key);
    });

    this.load.image('bg-sunset', 'art/bg/stage-sunset.png');
    this.load.image('plane-red', 'art/planes/plane-red.png');
    this.load.image('plane-red-top', 'art/planes/plane-red-top2.png');
    this.load.image('plane-red-under', 'art/planes/plane-red-under2.png');
    this.load.image('plane-blue', 'art/planes/plane-blue.png');
    this.load.image('plane-blue-top', 'art/planes/plane-blue-top2.png');
    this.load.image('plane-blue-under', 'art/planes/plane-blue-under2.png');
    this.load.image('balloon', 'art/props/baloon.png');
    this.load.image('balloon-gold', 'art/props/gold-baloon.png');
    // タイトル画面の絵。title-art はオープニングの完成図そのまま、
    // title-bg はそこからロゴと機体を除いた空だけの絵（ステージ選択用）
    this.load.image('title-art', 'art/title/opening-title.png');
    this.load.image('title-bg', 'art/title/opening-background.png');
    for (const k of DARK_PUFFS) this.load.image(k, `art/smoke/${k}.png`);
    for (const k of LIGHT_PUFFS) this.load.image(k, `art/smoke/${k}.png`);
  }

  /**
   * 読み込みの間の画面。
   *
   * 絵は合わせて 9MB ほどあり、回線によっては数秒かかる。
   * 何も出さないと真っ暗な画面が続いて、動いていないのか止まったのか分からない。
   * ここではまだ素材が無いので、線と文字だけで描く
   */
  private showProgress(): void {
    const w = 420;
    const x = (VIEW.width - w) / 2;
    const y = VIEW.height / 2;

    this.add.text(VIEW.width / 2, y - 54, 'BATTLE PLANES', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '34px', color: '#f4e6c8',
    }).setOrigin(0.5);
    const label = this.add.text(VIEW.width / 2, y + 34, '読み込み中 0%', {
      fontFamily: 'Georgia, serif', fontSize: '17px', color: '#f4e6c8',
    }).setOrigin(0.5).setAlpha(0.85);

    const bar = this.add.graphics();
    const draw = (p: number): void => {
      bar.clear();
      bar.lineStyle(2, 0xf4e6c8, 0.55);
      bar.strokeRect(x, y, w, 14);
      bar.fillStyle(0xd59a34, 1);
      bar.fillRect(x + 2, y + 2, (w - 4) * p, 10);
    };
    draw(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      draw(p);
      label.setText(`読み込み中 ${Math.round(p * 100)}%`);
    });
  }

  create(): void {
    if (this.missing.length > 0) {
      note(`絵を ${this.missing.length} 枚読めませんでした。そこだけ欠けた見た目になります。\n`
        + `  ${this.missing.join(' / ')}`);
    }
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
    this.scene.start('Opening');
  }
}
