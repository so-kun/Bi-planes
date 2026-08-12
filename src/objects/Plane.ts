/**
 * 機体。
 *
 * 見た目は側面図・上面図・下面図の 3 枚を重ね、ロール角に応じて
 * 透明度と縦の潰しを入れ替えることで機軸まわりの回転を表現する:
 *   0度   側面図（正立）
 *   90度  上面図（背中がこちらを向く。翼が画面いっぱいに開く）
 *   180度 側面図の上下反転（背面飛行）
 *   270度 下面図
 * 翼の見かけの高さは sin に比例するので、上面図・下面図を縦に潰しながら差し替える。
 */

import Phaser from 'phaser';
import { PLANE, VIEW, WEAPON } from '../config';
import { stepFlight, wrapPi, type FlightReadout, type FlightState } from '../flight';

export type Facing = 1 | -1;

export interface PlaneKeys {
  side: string;
  top: string;
  under: string;
}

export class Plane {
  readonly state: FlightState;
  readonly container: Phaser.GameObjects.Container;

  private side: Phaser.GameObjects.Image;
  private topView: Phaser.GameObjects.Image;
  private underView: Phaser.GameObjects.Image;

  facing: Facing = 1;
  hp = PLANE.maxHp;
  alive = true;
  /** 被弾による性能低下 */
  damage = { engine: 1, handling: 1 };

  cannonAmmo = WEAPON.cannon.ammo;
  private mgCooldown = 0;
  private cannonCooldown = 0;

  private rollFrom = 0;
  private rollTo = 0;
  private rollT = 1;

  readout: FlightReadout = { speed: 0, aoa: 0, stalled: false, cl: 0 };

  constructor(scene: Phaser.Scene, keys: PlaneKeys, x: number, y: number, facing: Facing) {
    // 左向きに飛ぶ機は、宙返りで到達した状態と同じ ―― 正立でいるには roll が π になる
    this.state = {
      x, y, vx: facing * 260, vy: 0,
      pitch: facing === 1 ? 0 : Math.PI,
      roll: facing === 1 ? 0 : Math.PI,
      throttle: 0,
    };
    this.facing = facing;

    const mk = (key: string): Phaser.GameObjects.Image => {
      const img = scene.add.image(0, 0, key).setOrigin(0.5);
      return img;
    };
    this.side = mk(keys.side);
    this.topView = mk(keys.top);
    this.underView = mk(keys.under);

    this.container = scene.add.container(x, y, [this.side, this.topView, this.underView]);
    this.applyRollVisual();
  }

  get x(): number { return this.state.x; }
  get y(): number { return this.state.y; }

  /** 機首（銃口）の位置と、弾を撃ち出す向き */
  muzzle(): { x: number; y: number; ux: number; uy: number } {
    const len = PLANE.width * 0.44;
    const ux = Math.cos(this.state.pitch);
    const uy = Math.sin(this.state.pitch);
    return { x: this.state.x + ux * len, y: this.state.y + uy * len, ux, uy };
  }

  /** エンジン（煙の出どころ）。機首よりわずかに後ろ */
  enginePos(): { x: number; y: number } {
    const m = this.muzzle();
    const back = PLANE.width * 0.16;
    return { x: m.x - m.ux * back, y: m.y - m.uy * back - PLANE.width * 0.04 };
  }

  /** ロール開始。連打しても途中では受け付けない */
  roll(): boolean {
    if (this.rollT < 1 || !this.alive) return false;
    this.rollFrom = this.state.roll;
    this.rollTo = this.state.roll + Math.PI;
    this.rollT = 0;
    return true;
  }

  get rolling(): boolean { return this.rollT < 1; }
  get inverted(): boolean { return Math.cos(this.state.roll) < 0; }

  /** スロットルは押している間だけ全開。毎フレーム外から設定する */
  setThrottle(level: number): void {
    this.state.throttle = level;
  }

  canFireMg(): boolean { return this.alive && this.mgCooldown <= 0; }
  canFireCannon(): boolean { return this.alive && this.cannonCooldown <= 0 && this.cannonAmmo > 0; }

  noteMgFired(): void { this.mgCooldown = WEAPON.mg.interval; }
  noteCannonFired(): void {
    this.cannonCooldown = WEAPON.cannon.interval;
    this.cannonAmmo--;
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    // 被弾ごとにエンジンか舵のどちらかが鈍る
    if (Math.random() < 0.5) this.damage.engine = Math.max(0.55, this.damage.engine - 0.09);
    else this.damage.handling = Math.max(0.5, this.damage.handling - 0.1);
  }

  reset(x: number, y: number, facing: Facing): void {
    this.state.x = x;
    this.state.y = y;
    this.state.vx = facing * 260;
    this.state.vy = 0;
    this.state.pitch = facing === 1 ? 0 : Math.PI;
    this.state.roll = facing === 1 ? 0 : Math.PI;
    this.state.throttle = 0;
    this.facing = facing;
    this.hp = PLANE.maxHp;
    this.damage = { engine: 1, handling: 1 };
    this.cannonAmmo = WEAPON.cannon.ammo;
    this.rollT = 1;
    this.alive = true;
    this.container.setVisible(true);
  }

  update(pitchInput: number, dt: number): void {
    if (!this.alive) return;

    this.mgCooldown = Math.max(0, this.mgCooldown - dt);
    this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);

    // ロールの進行。出だしと終わりを緩める
    if (this.rollT < 1) {
      this.rollT = Math.min(1, this.rollT + dt / PLANE.rollDuration);
      const t = this.rollT;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.state.roll = this.rollFrom + (this.rollTo - this.rollFrom) * e;
      if (this.rollT >= 1) {
        this.state.roll = ((this.rollTo % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      }
    }

    this.readout = stepFlight(this.state, { pitch: pitchInput }, dt, this.damage);

    // 画面端はラップアラウンド（本家準拠）
    const pad = PLANE.width;
    if (this.state.x < -pad) this.state.x += VIEW.width + pad * 2;
    if (this.state.x > VIEW.width + pad) this.state.x -= VIEW.width + pad * 2;
    if (this.state.y < VIEW.ceilingY) {
      this.state.y = VIEW.ceilingY;
      if (this.state.vy < 0) this.state.vy *= -0.2;
    }

    this.facing = Math.abs(wrapPi(this.state.pitch)) < Math.PI / 2 ? 1 : -1;
    this.container.setPosition(this.state.x, this.state.y);
    this.applyRollVisual();
  }

  /**
   * 向きの描画。
   * 原画の機首は左なので、常に左右反転して「回転 0 度＝右向き正立」に揃える。
   * あとはピッチで回し、ロールで 3 枚の絵を入れ替えるだけでよい。
   * 宙返りで左向きになると絵は上下逆になる ―― それが背面飛行そのもの。
   */
  private applyRollVisual(): void {
    const cs = Math.cos(this.state.roll);
    const sn = Math.sin(this.state.roll);
    this.container.setRotation(this.state.pitch);

    const setView = (img: Phaser.GameObjects.Image, alphaRaw: number, scaleY: number): void => {
      const alpha = Math.min(1, Math.abs(alphaRaw) * 1.8);
      img.setVisible(alpha > 0.012);
      if (alpha <= 0.012) return;
      const base = PLANE.width / img.width;
      img.setScale(-base, base * scaleY);
      img.setAlpha(alpha);
    };

    setView(this.side, cs, cs < 0 ? -1 : 1);   // 背面では上下反転
    setView(this.topView, sn > 0 ? sn : 0, Math.abs(sn));
    setView(this.underView, sn < 0 ? -sn : 0, Math.abs(sn));
  }

  destroy(): void {
    this.alive = false;
    this.container.setVisible(false);
  }
}
