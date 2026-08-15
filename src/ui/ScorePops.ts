/**
 * 得点の吹き出し。
 *
 * 点が入った**その場所**に「+3」を出して、ゆっくり浮かせながら消す。
 * 計器盤の数字だけでは、何で入った点なのかが分からない ――
 * 撃墜したのか、気球を割ったのか、相手が落ちたのかが、出た場所で分かるようにする。
 *
 * 色は入れた側の色（1P は赤、2P は青）。二人が同時に取っても、どちらの点か迷わない。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';

/** 浮いている時間（秒） */
const LIFE = 1.1;
/** 浮き上がる高さ */
const RISE = 52;
/** 出てくるときに大きくなる割合 */
const POP = 1.35;

interface Pop {
  text: Phaser.GameObjects.Text;
  x: number;
  y: number;
  t: number;
}

export class ScorePops {
  private list: Pop[] = [];

  constructor(private scene: Phaser.Scene, private depth = 74) {}

  /**
   * @param label 出す文字。`+3` のように符号を含めて渡す
   * @param color 入れた側の色（`#rrggbb`）
   */
  add(x: number, y: number, label: string, color: string): void {
    // 画面の外へはみ出すと読めないので、端から少し内側へ寄せる
    const px = Math.max(40, Math.min(VIEW.width - 40, x));
    const py = Math.max(70, Math.min(VIEW.height - 90, y));
    const text = this.scene.add.text(px, py, label, {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '34px', color,
      stroke: '#241a12', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(this.depth);
    this.list.push({ text, x: px, y: py, t: 0 });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.t >= LIFE) {
        p.text.destroy();
        this.list.splice(i, 1);
        continue;
      }
      const k = p.t / LIFE;
      // 出だしは速く、あとはゆっくり。最後の3割で消えていく
      p.text.setY(p.y - RISE * (1 - (1 - k) * (1 - k)));
      p.text.setAlpha(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      // ぽんと出て、すぐ元の大きさに戻る
      const s = k < 0.18 ? 1 + (POP - 1) * (1 - k / 0.18) : 1;
      p.text.setScale(s);
    }
  }

  destroy(): void {
    for (const p of this.list) p.text.destroy();
    this.list = [];
  }
}
