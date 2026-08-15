/**
 * 弾。7.7mm は直線・高速・射程は画面幅の約60%、20mm は低速・短射程・山なり。
 * 見た目も分けてある: 7.7mm は細い曳光、20mm は橙に光る弾体＋煙の尾。
 */

import Phaser from 'phaser';
import { WEAPON, groundAt, wrapX } from '../config';
import { settings } from '../settings';

export type BulletKind = 'mg' | 'cannon';

export interface Bullet {
  kind: BulletKind;
  x: number;
  y: number;
  /**
   * 前のフレームの位置。当たり判定は**この点と今の点を結んだ線分**で見る
   * （`src/collision.ts`）。弾は速く、点で見ると機体をまたいで通り抜ける。
   * 画面端で回り込んだフレームだけは、飛んだぶんを線分にしないよう今の位置を入れる
   */
  px: number;
  py: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  gravity: number;
  damage: number;
  /** 撃った側。自分の弾で当たらないようにする */
  owner: number;
  trail: { x: number; y: number }[];
}

export class Bullets {
  readonly list: Bullet[] = [];
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number) {
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(depth);
  }

  fire(kind: BulletKind, x: number, y: number, ux: number, uy: number, owner: number): void {
    const spec = kind === 'mg' ? WEAPON.mg : WEAPON.cannon;
    // 7.7mm の威力はオプションで変えられる。20mm は一撃撃墜のまま
    const damage = kind === 'mg' ? settings.mgDamage : spec.damage;
    const spread = spec.spread ? (Math.random() - 0.5) * spec.spread : 0;
    const ca = Math.cos(spread), sa = Math.sin(spread);
    const dx = ux * ca - uy * sa;
    const dy = ux * sa + uy * ca;
    this.list.push({
      kind, x, y, px: x, py: y,
      vx: dx * spec.speed, vy: dy * spec.speed,
      t: 0, life: spec.life, gravity: spec.gravity, damage,
      owner, trail: [],
    });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t += dt;
      // 消えるのは寿命が尽きたときと地面に当たったとき。
      // 左右は消さずに回り込ませる ―― 機体だけが向こう側から出てきて弾は端で消える、
      // という食い違いをなくすため（機体と同じ `wrapX`）
      if (b.t >= b.life || b.y > groundAt(b.x) + 30) {
        this.list.splice(i, 1);
        continue;
      }
      b.px = b.x;
      b.py = b.y;
      b.vy += b.gravity * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const wrapped = wrapX(b.x);
      if (wrapped !== b.x) {
        b.x = wrapped;
        // 回り込んだフレームは画面を横断する線分になってしまうので、判定に使わない
        b.px = b.x;
        b.py = b.y;
        b.trail.length = 0;
      }
      if (b.kind === 'cannon') {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 16) b.trail.shift();
      }
    }
  }

  remove(b: Bullet): void {
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const b of this.list) {
      if (b.kind === 'mg') {
        const tx = b.x - b.vx * 0.014;
        const ty = b.y - b.vy * 0.014;
        g.lineStyle(4.5, 0xffba4a, 0.24);
        g.lineBetween(tx, ty, b.x, b.y);
        g.lineStyle(1.8, 0xfff3cc, 0.92);
        g.lineBetween(tx, ty, b.x, b.y);
      } else {
        b.trail.forEach((s, j) => {
          const k = j / b.trail.length;
          g.fillStyle(0x6e6154, k * 0.34);
          g.fillCircle(s.x, s.y, 2 + k * 4);
        });
        g.fillStyle(0xff9e36, 0.5);
        g.fillCircle(b.x, b.y, 11);
        g.fillStyle(0xfff0be, 0.85);
        g.fillCircle(b.x, b.y, 6);
        g.fillStyle(0xfffae6, 0.98);
        g.fillCircle(b.x, b.y, 3.4);
      }
    }
  }
}
