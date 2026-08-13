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
  /** 合図が終わる実時刻（ミリ秒）。0 なら合図は出ていない */
  private endsAt = 0;
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
    this.endsAt = performance.now() + COUNT_TOTAL * 1000;
    this.left = COUNT_TOTAL;
    this.lastBeep = -1;
    this.text.setVisible(true);
  }

  get running(): boolean { return this.endsAt !== 0; }

  /**
   * @returns 合図が終わって本編が動いているか
   *
   * 残り時間は**実時刻で測る**。1コマぶんの刻みを足していく数え方だと、
   * 遅い機械では刻みが頭打ちになるぶん実時間が延びる ―― 実測で 14 コマ/秒だと
   * 3 秒の合図が 11 秒かかった。合図の間は操作を受け付けないので、
   * そのぶん「押しても効かない」時間が延びてしまう
   */
  tick(): boolean {
    if (this.endsAt === 0) return true;
    this.left = (this.endsAt - performance.now()) / 1000;
    if (this.left <= 0) {
      this.endsAt = 0;
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
