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
  /**
   * 金色のときだけ置く後光。
   * 色を染めるだけでは夕焼けの空に埋もれて普通の気球と見分けがつかないため、
   * 後ろから光らせて目立たせる
   */
  halo: Phaser.GameObjects.Image | null;
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
      'balloon',
    );
    img.setDisplaySize(BALLOON.width, BALLOON.width * (img.height / img.width));

    // 金色は色を染めたうえで後光を添える。別の絵を用意すると絵柄が浮くため、
    // 光は煙の絵を黄色く染めたものを流用する
    let halo: Phaser.GameObjects.Image | null = null;
    if (gold) {
      img.setTint(0xffd23a);
      halo = this.scene.add.image(img.x, img.y, 'puff-dark-01-core');
      halo.setDisplaySize(BALLOON.width * 2, BALLOON.width * 2);
      halo.setBlendMode(Phaser.BlendModes.ADD);
      this.layer.add(halo);
    }
    this.layer.add(img);

    this.list.push({
      img, halo,
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
    b.halo?.destroy();
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
      // 金色はゆっくり明滅させて、普通の気球と一目で見分けられるようにする
      if (b.halo) {
        const k = 0.5 + Math.sin(b.sway * 2.4) * 0.5;
        b.halo.setPosition(b.img.x, b.img.y - b.img.displayHeight * 0.16);
        b.halo.setAlpha(0.22 + k * 0.2);
        const size = BALLOON.width * (1.7 + k * 0.25);
        b.halo.setDisplaySize(size, size);
      }
      if (b.img.y < -BALLOON.width * 1.6) {
        b.img.destroy();
        b.halo?.destroy();
        this.list.splice(i, 1);
      }
    }
  }
}
