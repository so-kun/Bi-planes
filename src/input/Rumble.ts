/**
 * パッドの振動。
 *
 * 起きたことを手に返す。**弾は高いほうの錘、爆発は低いほうの錘**を効かせてある ――
 * `dual-rumble` は大小2つの錘を別々に回せるので、同じ強さでも別のものとして手に伝わる。
 *
 * 対応しているのは Chrome と Edge（Safari は非対応、Firefox は機種による）。
 * **使えない環境では黙って何もしない** ―― 振動はあくまで添えもので、
 * 無いことで遊べなくなってはいけない。
 *
 * 人ごとに1つ持ち、読んでいるのと同じパッドへ送る（`PadInput.gamepadIndex`）。
 * 撃たれていない側の手が震えないようにするため。
 */

import { settings } from '../settings';

export type RumbleKind = 'hit' | 'strain' | 'explosion';

interface Spec {
  /** 秒 */
  duration: number;
  /** 高い周波数の小さな錘。弾く感じ */
  weak: number;
  /** 低い周波数の大きな錘。腹に来る感じ */
  strong: number;
  /**
   * 強いものが鳴っている間、弱いものでは上書きしない。
   * `playEffect` は後から頼んだものが前のものを打ち切る決まりなので、
   * 順位を持たないと、撃墜の手応えが直後の細かい振動で消える
   */
  priority: number;
}

const SPEC: Record<RumbleKind, Spec> = {
  /** 7.7mm を受けた。一発ごとに短く弾く（連射で埋もれないよう軽く） */
  hit: { duration: 0.11, weak: 0.45, strong: 0.15, priority: 1 },
  /** 水温が赤帯。止まらない低いうなりを、少しずつ重ねて出す */
  strain: { duration: 0.26, weak: 0.30, strong: 0.25, priority: 0 },
  /** 撃墜された。手に残る一撃 */
  explosion: { duration: 0.42, weak: 0.65, strong: 1.0, priority: 2 },
};

/** 赤帯のうなりを送り直す間隔（秒）。長さより少し短くして、切れ目を作らない */
export const STRAIN_INTERVAL = 0.24;

export class Rumble {
  /** 今鳴らしているものが終わる時刻（秒）と、その順位 */
  private until = 0;
  private priority = -1;
  /** 一度でも断られたら、以後は何もしない（毎フレーム例外を出さないため） */
  private dead = false;

  /**
   * @param side  1P = 0、2P = 1。強さの設定を引くのに使う
   * @param index 送り先のパッド番号（`PadInput.gamepadIndex`）。-1 なら何もしない
   * @param now   今の時刻（秒）。呼ぶ側の時計をそのまま渡す
   * @param scale 追加の倍率。赤帯のうなりを水温で強くするのに使う
   */
  play(side: number, index: number, kind: RumbleKind, now: number, scale = 1): void {
    if (this.dead || index < 0) return;
    const strength = (settings.rumble[side] ?? 1) * scale;
    if (strength <= 0) return;

    const spec = SPEC[kind];
    // 鳴っている最中に、より弱いものが割り込まないようにする
    if (now < this.until && spec.priority < this.priority) return;

    const pad = this.pad(index);
    const actuator = pad?.vibrationActuator;
    if (!actuator?.playEffect) return;

    const weak = Math.min(1, spec.weak * strength);
    const strong = Math.min(1, spec.strong * strength);
    try {
      const done = actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: spec.duration * 1000,
        weakMagnitude: weak,
        strongMagnitude: strong,
      });
      // 断られたときの約束が拾われないままだと、未処理の失敗として残る
      void done?.catch?.(() => {});
    } catch {
      this.dead = true;              // この環境では使えない。以後は静かにやめる
      return;
    }
    this.until = now + spec.duration;
    this.priority = spec.priority;
  }

  /** 画面を出るときなど。鳴りっぱなしを断つ */
  stop(index: number): void {
    this.until = 0;
    this.priority = -1;
    try {
      const actuator = this.pad(index)?.vibrationActuator;
      void actuator?.reset?.()?.catch?.(() => {});
    } catch {
      this.dead = true;
    }
  }

  private pad(index: number): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pad = navigator.getGamepads()[index];
    return pad && pad.connected ? pad : null;
  }
}
