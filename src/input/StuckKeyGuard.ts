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
 *
 * これとは別に、**押し直されたのに押しっぱなし扱いのままのキーはその場で解除する**。
 * Phaser は押しっぱなしのキーには押した合図（Key の down）を出さない
 * （`Key.onDown` は `isDown` が false のときだけ出す）。離した合図をひとつ取りこぼすと、
 * そのキーは**二度と反応しなくなる** ―― メニューの上下も、ロールも、機関砲も。
 * 「一度押したらそれきり効かない」という症状はこれで起きる。
 *
 * 取りこぼしは、押し直しの keydown（繰り返しでない keydown）が
 * 押しっぱなしのキーに届いた時点で分かる。そこで解除しておけば、
 * このあと Phaser が同じ出来事を処理するときには正しく「押された」と読める
 * （こちらは捕捉フェーズで先に受け取るため）。
 */

import type Phaser from 'phaser';

/**
 * これだけ keydown が途絶えたら、もう離されているとみなす。
 * OS のキーリピートが始まるまでの待ち時間は最長でも 1 秒ほどなので、
 * それを十分に超える値にして、押し続けているキーを誤って解除しないようにする
 */
const STALE_MS = 1600;

/**
 * 前の keydown からこれだけ空いていれば、押しっぱなしの繰り返しではなく押し直し。
 * OS のキーリピートは長くても 1 秒ほどで始まり、そのあとは数十 ms 間隔で届く
 */
const FRESH_MS = 900;

export class StuckKeyGuard {
  private lastDownAt = new Map<number, number>();
  private sawRepeat = false;
  private released = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const now = performance.now();
    if (e.repeat) this.sawRepeat = true;
    else this.recover(e.keyCode, now);
    this.lastDownAt.set(e.keyCode, now);
  };

  /**
   * 押し直しなのに押しっぱなし扱いのままなら、離した合図を取りこぼしている。解除する。
   *
   * 押しっぱなしの繰り返しを「押し直し」と読み違えると、押している間じゅう
   * ロールや機関砲が出てしまう。繰り返しは数十 ms 間隔で届くので、
   * 前の keydown から十分に間が空いているときだけ解除する
   */
  private recover(code: number, now: number): void {
    const last = this.lastDownAt.get(code);
    if (last !== undefined && now - last < FRESH_MS) return;
    for (const key of Object.values(this.keys)) {
      if (key.keyCode !== code || !key.isDown) continue;
      key.reset();
      this.released++;
    }
  }

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
