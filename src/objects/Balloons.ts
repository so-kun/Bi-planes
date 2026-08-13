/**
 * 気球。下からランダムに上がってくる的。
 * 当たり判定は球皮だけにしてある（籠や索には当たらない）。狙いの気持ちよさのため。
 */

import Phaser from 'phaser';
import { BALLOON, VIEW } from '../config';

export interface Balloon {
  img: Phaser.GameObjects.Image;
  vy: number;
  sway: number;
  swayAmp: number;
  /** 金色のボーナス気球。撃つと撃った側の機体が直る */
  gold: boolean;
}

export class Balloons {
  readonly list: Balloon[] = [];
  private timer = 4;

  constructor(private scene: Phaser.Scene, private layer: Phaser.GameObjects.Container) {}

  spawn(x?: number, gold = Math.random() < BALLOON.goldChance): void {
    if (this.list.length >= BALLOON.maxAlive) return;
    const img = this.scene.add.image(
      x ?? Phaser.Math.Between(160, VIEW.width - 160),
      VIEW.height + BALLOON.width,
      gold ? 'balloon-gold' : 'balloon',
    );
    img.setDisplaySize(BALLOON.width, BALLOON.width * (img.height / img.width));

    // 金色は専用の絵を使う（2026-08-13 差し替え）。
    // それまでは通常の気球を色染めして後光を添えていたが、絵があるなら要らない
    this.layer.add(img);

    this.list.push({
      img,
      vy: -Phaser.Math.FloatBetween(BALLOON.riseMin, BALLOON.riseMax),
      sway: Math.random() * 6.3,
      swayAmp: Phaser.Math.FloatBetween(6, 16),
      gold,
    });
  }

  /** 球皮の中心と半径 */
  hitBox(b: Balloon): { x: number; y: number; r: number } {
    return {
      x: b.img.x,
      y: b.img.y - b.img.displayHeight * 0.16,
      r: BALLOON.width * 0.4,
    };
  }

  pop(b: Balloon): void {
    b.img.destroy();
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = Phaser.Math.FloatBetween(BALLOON.spawnMin, BALLOON.spawnMax);
      this.spawn();
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.sway += dt * 1.4;
      b.img.y += b.vy * dt;
      b.img.x += Math.sin(b.sway) * b.swayAmp * dt;
      b.img.setRotation(Math.sin(b.sway) * 0.05);
      if (b.img.y < -BALLOON.width * 1.6) {
        b.img.destroy();
        this.list.splice(i, 1);
      }
    }
  }
}
