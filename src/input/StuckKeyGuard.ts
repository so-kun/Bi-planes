/**
 * 押しっぱなしになったキーを見つけて解除する。
 *
 * ブラウザによっては、キーを離したイベント（keyup）が届かないことがある。
 * 別のタブやウィンドウへ移ったとき、あるいは Safari のように実装差がある場合で、
 * こうなるとゲーム側はキーが押され続けていると思い込んでしまう。
 *
 * 仕組みは単純で、キーを押し続けている間ブラウザが keydown を繰り返し送ってくることを使う。
 * 押されているはずなのに、しばらく keydown が来ていないキーは、
 * 実際にはもう離されているとみなして解除する。
 *
 * 「繰り返しの keydown を送らないブラウザ」で誤って解除しないよう、
 * 一度でも繰り返しを観測するまでは働かない。
 */

import type Phaser from 'phaser';

/**
 * これだけ keydown が途絶えたら、もう離されているとみなす。
 * OS のキーリピートが始まるまでの待ち時間は最長でも 1 秒ほどなので、
 * それを十分に超える値にして、押し続けているキーを誤って解除しないようにする
 */
const STALE_MS = 1600;

export class StuckKeyGuard {
  private lastDownAt = new Map<number, number>();
  private sawRepeat = false;
  private released = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) this.sawRepeat = true;
    this.lastDownAt.set(e.keyCode, performance.now());
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.lastDownAt.delete(e.keyCode);
  };

  constructor(private keys: Record<string, Phaser.Input.Keyboard.Key>) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
  }

  /** 解除した回数。デバッグ表示用 */
  get releasedCount(): number {
    return this.released;
  }

  update(): void {
    if (!this.sawRepeat) return;
    const now = performance.now();
    for (const key of Object.values(this.keys)) {
      if (!key.isDown) continue;
      const last = this.lastDownAt.get(key.keyCode);
      if (last !== undefined && now - last <= STALE_MS) continue;
      key.reset();
      this.lastDownAt.delete(key.keyCode);
      this.released++;
    }
  }

  /** いま押されているキーの名前。デバッグ表示用 */
  heldNames(): string[] {
    return Object.entries(this.keys).filter(([, k]) => k.isDown).map(([n]) => n);
  }
}
