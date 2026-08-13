/**
 * ゲームパッドの読み取り。
 *
 * ブラウザのイベント（gamepadconnected）は当てにせず、毎フレーム今の状態を読みに行く。
 * イベントは環境によって飛んでこないことがあるうえ、この方式なら
 * キーボードで悩まされた「押しっぱなしが残る」問題が原理的に起きない ――
 * 離した瞬間に、読み取った値がそのまま離した状態になる。
 *
 * ロールと 20mm は「押した瞬間」だけ働く操作なので、前のフレームと比べて立ち上がりを拾う。
 */

import { PAD } from '../config';
import { note } from '../diagnostics';

export interface PadState {
  connected: boolean;
  /** パッドの名前。デバッグ表示用 */
  id: string;
  /** 標準配列でないパッドがつながっている。使えない旨を伝えるために持つ */
  unsupported: boolean;
  /** 機首。画面の上が正。スティックは倒した量がそのまま出る */
  pitch: number;
  /** ロール。押した瞬間だけ -1（L）か 1（R）になる */
  rollEdge: -1 | 0 | 1;
  throttle: boolean;
  mg: boolean;
  /** 20mm。押した瞬間だけ true */
  cannonEdge: boolean;
}

const IDLE: PadState = {
  connected: false, id: '', unsupported: false,
  pitch: 0, rollEdge: 0, throttle: false, mg: false, cannonEdge: false,
};

export class PadInput {
  private prevRoll: -1 | 0 | 1 = 0;
  private prevCannon = false;

  /** @param index 標準配列のパッドの何台目を使うか。1P = 0、2P = 1 */
  constructor(private index = 0) {}

  /**
   * つながっているパッドのうち、標準配列のものを数えて index 番目。
   * 1P は 0 番目、2P は 1 番目を使う。つないだ順に割り当たる。
   *
   * 標準配列でないものは受け付けない。並びが機種固有なので、
   * 番号をそのまま読むと見当違いのボタンが操作に化けるため。
   * ブラウザはボタンが一度押されるまでパッドを見せてくれないので、
   * つないだ直後は何も返らないことがある（仕様どおり）
   */
  private pick(): { pad: Gamepad | null; other: Gamepad | null } {
    if (!navigator.getGamepads) return { pad: null, other: null };
    let other: Gamepad | null = null;
    let n = 0;
    for (const p of navigator.getGamepads()) {
      if (!p || !p.connected) continue;
      if (p.mapping === 'standard') {
        if (n++ === this.index) return { pad: p, other: null };
        continue;
      }
      other ??= p;
    }
    // 標準配列でないパッドの警告は 1P 側だけが出す。2人分並べても仕方がない
    return { pad: null, other: this.index === 0 ? other : null };
  }

  /**
   * 今の状態を読む。ここは毎フレーム、画面の処理の中から呼ばれる。
   * 例外を外へ出すと画面が止まり、キーもパッドも効かなくなるので、
   * 何かあってもパッド無しとして返す
   */
  read(): PadState {
    try {
      return this.readPad();
    } catch (err) {
      if (!PadInput.warned) {
        PadInput.warned = true;
        note(`パッドを読めませんでした。パッド無しで続けます。\n  ${String(err)}`);
      }
      return IDLE;
    }
  }

  private static warned = false;

  private readPad(): PadState {
    const { pad, other } = this.pick();
    if (!pad) {
      // 抜かれたときに立ち上がりの記録が残っていると、挿し直した瞬間に暴発する
      this.prevRoll = 0;
      this.prevCannon = false;
      return other ? { ...IDLE, id: other.id, unsupported: true } : IDLE;
    }

    const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    const value = (i: number): number => pad.buttons[i]?.value ?? 0;
    const axis = (i: number): number => pad.axes[i] ?? 0;

    const b = PAD.buttons;

    // 機首。スティックを優先し、十字キーは倒し切りとして扱う
    const raw = -axis(PAD.axes.pitch);
    let pitch = Math.abs(raw) < PAD.deadzone ? 0 : raw;
    if (pressed(b.up)) pitch = 1;
    if (pressed(b.down)) pitch = -1;

    // ロールは L / R ボタン。左右を同時に押したときは何もしない
    const roll: -1 | 0 | 1 = pressed(b.rollR) === pressed(b.rollL) ? 0 : pressed(b.rollR) ? 1 : -1;
    const rollEdge: -1 | 0 | 1 = roll !== 0 && this.prevRoll === 0 ? roll : 0;
    this.prevRoll = roll;

    // トリガーはアナログなので、押し込みの深さでも判定する。
    // 浅く握っただけで全開にならないよう、しきい値を設けてある
    const throttle = pressed(b.throttle) || value(b.throttle) >= PAD.triggerThreshold;

    const cannon = pressed(b.cannon);
    const cannonEdge = cannon && !this.prevCannon;
    this.prevCannon = cannon;

    return {
      connected: true,
      id: pad.id,
      unsupported: false,
      pitch: Math.max(-1, Math.min(1, pitch)),
      rollEdge,
      throttle,
      mg: pressed(b.mg),
      cannonEdge,
    };
  }
}
