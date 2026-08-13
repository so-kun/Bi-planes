/**
 * パッドでの「決定・取り消し・中断」の受け付け。
 *
 * 決定（○／A）と取り消し（×／B）は 20mm・7.7mm と同じボタンなので、
 * そのまま読むと押した勢いが次の場面まで届いてしまう ――
 * 決定して対戦に入った瞬間に 20mm が出る、撃ち合いの最中に決着が出て
 * その一発でもう一度が始まる、といった具合に。
 *
 * そこで **一度どのボタンも押されていない状態を見るまでは受け付けない**。
 * 場面が変わったところで `disarm()` を呼べば、指をいったん離すまで反応しなくなる。
 */

import type { PadState } from './PadInput';

export interface PadMenuEdges {
  /** ○／A。決定・続行 */
  decide: boolean;
  /** ×／B。取り消し・戻る */
  cancel: boolean;
  /** Start。飛行中の中断 */
  start: boolean;
  /** Select。やり直し */
  select: boolean;
}

const NONE: PadMenuEdges = { decide: false, cancel: false, start: false, select: false };

export class PadMenu {
  private armed = false;

  /** 指を離すまで受け付けない状態に戻す */
  disarm(): void {
    this.armed = false;
  }

  read(s: PadState): PadMenuEdges {
    if (!s.connected) {
      this.armed = false;
      return NONE;
    }
    if (!this.armed) {
      // どのボタンも押されていないところまで待ってから受け付けはじめる
      if (!s.anyFace) this.armed = true;
      return NONE;
    }
    return {
      decide: s.decideEdge,
      cancel: s.cancelEdge,
      start: s.startEdge,
      select: s.selectEdge,
    };
  }
}
