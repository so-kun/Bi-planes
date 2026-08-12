/**
 * 煙・火・破片のパーティクル。
 * Phaser の標準パーティクルではなく、寿命ごとに大きさ・透明度・速度を細かく
 * 制御したいので、軽い自前のプールにしている。
 */

import Phaser from 'phaser';
import { PLANE, SMOKE } from '../config';

type Layer = Phaser.GameObjects.Container;

interface Puff {
  img: Phaser.GameObjects.Image;
  t: number;
  life: number;
  delay: number;
  size: number;
  grow: number;
  vx: number;
  vy: number;
  spin: number;
  peak: number;
  x0: number;
  y0: number;
}

interface Shard {
  gfx: Phaser.GameObjects.Rectangle;
  t: number;
  life: number;
  vx: number;
  vy: number;
  spin: number;
}

const rand = Phaser.Math.FloatBetween;
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const DARK = ['puff-dark-01', 'puff-dark-02', 'puff-dark-03', 'puff-dark-04'];
const WHITE = DARK.map((k) => `${k}-white`);
const FIRE = DARK.map((k) => `${k}-fire`);
const CORE = DARK.map((k) => `${k}-core`);
const EMBER = DARK.map((k) => `${k}-ember`);
const DUST = DARK.map((k) => `${k}-dust`);
const BSMOKE = DARK.map((k) => `${k}-bsmoke`);

export class Particles {
  private puffs: Puff[] = [];
  private shards: Shard[] = [];

  /**
   * @param below 機体より奥に描く層（飛行中の煙）
   * @param above 機体より手前に描く層（爆発の煙）
   * @param fire  さらに手前（火の玉。煙に隠れると爆発に見えない）
   */
  constructor(
    private scene: Phaser.Scene,
    private below: Layer,
    private above: Layer,
    private fire: Layer,
  ) {}

  private spawn(layer: Layer, key: string, x: number, y: number, o: Partial<Puff>): void {
    const img = this.scene.add.image(x, y, key);
    img.setOrigin(0.5);
    img.setAlpha(0);
    img.setRotation(rand(-0.35, 0.35));
    layer.add(img);
    this.puffs.push({
      img, t: 0, life: 1, delay: 0, size: 40, grow: 1.8,
      vx: 0, vy: 0, spin: rand(-0.25, 0.25), peak: 0.9, x0: x, y0: y,
      ...o,
    });
  }

  /**
   * 被弾の煙。どこをやられたかが色でわかるようにする。
   * エンジン損傷は黒煙、操作系（舵）損傷は白煙。
   */
  damage(x: number, y: number, kind: 'engine' | 'handling'): void {
    const w = PLANE.width;
    const engine = kind === 'engine';
    this.spawn(this.below, pick(engine ? DARK : WHITE), x, y, {
      life: rand(SMOKE.damageLife[0], SMOKE.damageLife[1]),
      size: w * rand(SMOKE.damageSize[0], SMOKE.damageSize[1]),
      grow: 1.7,
      vx: rand(26, 48),
      vy: rand(-32, -16),
      peak: engine ? SMOKE.damageAlpha.engine : SMOKE.damageAlpha.handling,
    });
  }

  /** 20mm の発射煙 */
  muzzleSmoke(x: number, y: number): void {
    const w = PLANE.width;
    for (let i = 0; i < 3; i++) {
      this.spawn(this.above, pick(WHITE), x, y, {
        life: rand(0.5, 0.9), size: w * rand(0.12, 0.2), grow: 2.0,
        vx: rand(-20, 20), vy: rand(-30, -8), peak: 0.5,
      });
    }
  }

  /**
   * 爆発。
   * 閃光 → 白熱した芯 → 火の玉 → 破片 → 遅れて黒煙、の順に立ち上がる。
   * 地面への激突では火は上半分だけに立ち上がり、土煙が左右へ広がる。
   */
  explode(x: number, y: number, ground: boolean): void {
    const w = PLANE.width;

    // 白熱した芯
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2);
      const r0 = w * rand(0, 0.2);
      this.spawn(this.fire, pick(CORE), x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        life: rand(0.22, 0.34), size: w * rand(0.38, 0.64), grow: 1.7, peak: 1,
        vx: Math.cos(a) * w * 0.22, vy: Math.sin(a) * w * 0.22 - w * 0.08,
        delay: rand(0, 0.03),
      });
    }
    // 火の玉
    const nFire = ground ? 8 : 10;
    for (let i = 0; i < nFire; i++) {
      const a = ground ? -Math.PI / 2 + rand(-0.58, 0.58) * Math.PI : rand(0, Math.PI * 2);
      const sp = w * rand(0.22, 0.64);
      const r0 = w * rand(0, 0.16);
      this.spawn(this.fire, pick(FIRE), x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        life: rand(0.58, 0.88), size: w * rand(0.5, 0.84), grow: 1.55, peak: 1,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - w * 0.12,
        delay: rand(0, 0.06),
      });
    }
    // 燃え残り
    for (let i = 0; i < 5; i++) {
      const a = ground ? -Math.PI / 2 + rand(-0.5, 0.5) * Math.PI : rand(0, Math.PI * 2);
      const sp = w * rand(0.22, 0.6);
      const r0 = w * rand(0, 0.2);
      this.spawn(this.fire, pick(EMBER), x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        life: rand(0.8, 1.2), size: w * rand(0.4, 0.66), grow: 1.7, peak: 0.8,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - w * 0.25,
        delay: rand(0.1, 0.24),
      });
    }
    // 黒煙
    for (let i = 0; i < (ground ? 9 : 8); i++) {
      const a = ground ? -Math.PI / 2 + rand(-0.65, 0.65) * Math.PI : rand(0, Math.PI * 2);
      const sp = w * rand(0.2, 0.62);
      const r0 = w * rand(0, 0.22);
      this.spawn(this.above, pick(Math.random() < 0.5 ? DARK : BSMOKE),
        x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
          life: rand(1.9, 3.0), size: w * rand(0.42, 0.72), grow: 2.1, peak: 0.85,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - w * 0.55,
          delay: rand(0.26, 0.56),
        });
    }
    // 土煙（地面のみ）
    if (ground) {
      for (let i = 0; i < 8; i++) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.spawn(this.above, pick(DUST), x + dir * w * rand(0, 0.35), y + w * 0.05, {
          life: rand(1.5, 2.3), size: w * rand(0.26, 0.5), grow: 2.4, peak: 0.72,
          vx: dir * w * rand(0.7, 1.6), vy: -w * rand(0.05, 0.23),
          delay: rand(0.1, 0.28),
        });
      }
    }
    // 破片
    const nSh = ground ? 8 : 11;
    for (let i = 0; i < nSh; i++) {
      const a = ground ? -Math.PI / 2 + rand(-0.55, 0.55) * Math.PI : rand(0, Math.PI * 2);
      const r = Math.random();
      const sp = w * (0.7 + r * r * 3.6);
      this.addShard(x, y, Math.cos(a) * sp, Math.sin(a) * sp - w * 0.4, w);
    }
  }

  /** 気球が割れる。爆発より小ぶりで、布の破片が飛ぶ */
  popBalloon(x: number, y: number): void {
    const w = PLANE.width;
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = w * rand(0.3, 0.8);
      this.spawn(this.fire, pick(FIRE), x, y, {
        life: rand(0.34, 0.52), size: w * rand(0.22, 0.4), grow: 1.7, peak: 0.9,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - w * 0.2, delay: rand(0, 0.05),
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = w * rand(0.25, 0.65);
      this.spawn(this.above, pick(DARK), x, y, {
        life: rand(1.0, 1.6), size: w * rand(0.24, 0.44), grow: 2.0, peak: 0.7,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - w * 0.4, delay: rand(0.1, 0.26),
      });
    }
    for (let i = 0; i < 7; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = w * rand(0.6, 2.2);
      this.addShard(x, y, Math.cos(a) * sp, Math.sin(a) * sp - w * 0.5, w * 0.7);
    }
  }

  private addShard(x: number, y: number, vx: number, vy: number, w: number): void {
    const rw = w * rand(0.016, 0.04);
    const rh = w * rand(0.011, 0.028);
    const gfx = this.scene.add.rectangle(x, y, rw, rh, 0x4a3728);
    gfx.setStrokeStyle(Math.max(1, w * 0.012), 0x1a120c);
    this.above.add(gfx);
    this.shards.push({ gfx, t: 0, life: rand(1.0, 1.8), vx, vy, spin: rand(-7, 7) });
  }

  update(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const q = this.puffs[i];
      q.t += dt;
      if (q.t < q.delay) continue;
      const k = (q.t - q.delay) / q.life;
      if (k >= 1) {
        q.img.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - k) * (1 - k);
      const s = q.size * (1 + (q.grow - 1) * ease);
      q.img.setDisplaySize(s, s * (q.img.height / q.img.width));
      q.img.setPosition(q.x0 + q.vx * ease * q.life, q.y0 + q.vy * ease * q.life);
      q.img.setRotation(q.img.rotation + q.spin * dt);
      q.img.setAlpha(Math.max(0, (k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92) * q.peak));
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const p = this.shards[i];
      p.t += dt;
      if (p.t >= p.life) {
        p.gfx.destroy();
        this.shards.splice(i, 1);
        continue;
      }
      p.vy += 620 * dt;
      p.gfx.x += p.vx * dt;
      p.gfx.y += p.vy * dt;
      p.gfx.rotation += p.spin * dt;
      const fade = p.t > p.life * 0.75 ? 1 - (p.t - p.life * 0.75) / (p.life * 0.25) : 1;
      p.gfx.setAlpha(Math.max(0, fade));
    }
  }
}
