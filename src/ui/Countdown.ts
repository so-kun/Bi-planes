/**
 * 開始の合図。READY? → 3 → 2 → 1 → GO! と出して、終わったら試合を動かす。
 * 対戦とプラクティスの両方で使う。
 *
 * 合図の間に何を止めるかは呼ぶ側の仕事。ここは表示と音と時間だけを持つ。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';
import { sfx } from '../audio';

/** 各段の長さ（秒） */
export const COUNT = { ready: 0.9, numbers: 0.55, go: 0.5 };
export const COUNT_TOTAL = COUNT.ready + COUNT.numbers * 3 + COUNT.go;

export class Countdown {
  private left = 0;
  /** 直前に鳴らした数字。同じ数字で二度鳴らさないための記録 */
  private lastBeep = -1;
  private text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, y = VIEW.height / 2 - 60) {
    this.text = scene.add.text(VIEW.width / 2, y, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '78px', color: '#f4e6c8',
      align: 'center', stroke: '#241a12', strokeThickness: 9,
    }).setOrigin(0.5).setDepth(73).setVisible(false);
  }

  begin(): void {
    this.left = COUNT_TOTAL;
    this.lastBeep = -1;
    this.text.setVisible(true);
  }

  get running(): boolean { return this.left > 0; }

  /** @returns 合図が終わって本編が動いているか */
  tick(dt: number): boolean {
    if (this.left <= 0) return true;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.text.setVisible(false);
      return true;
    }

    // 残り時間から「今どの表示か」を出す。READY? のあとに 3・2・1、最後に GO!
    const rest = this.left - COUNT.go;
    let label: string;
    let beepAt: number;
    if (rest <= 0) {
      label = 'GO!';
      beepAt = 0;
    } else if (rest <= COUNT.numbers * 3) {
      const n = Math.ceil(rest / COUNT.numbers);
      label = String(n);
      beepAt = n;
    } else {
      label = 'READY?';
      beepAt = -1;
    }

    if (beepAt !== this.lastBeep) {
      this.lastBeep = beepAt;
      if (beepAt >= 0) sfx.beep(beepAt === 0);
    }

    this.text.setText(label);
    this.text.setColor(label === 'GO!' ? '#ffd76b' : '#f4e6c8');
    this.text.setFontSize(label === 'READY?' ? 54 : 78);
    return false;
  }
}
