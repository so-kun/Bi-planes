/**
 * プラクティスの輪。番号の順に潜る。
 *
 * 絵は毎フレーム描く。提供イラストの絵柄に合わせるため、真円ではなく
 * ペンで一筆書きしたような揺らぎを持たせている（揺らぎの形は輪ごとに固定）。
 *
 * 潜ったかどうかは「機体の中心が輪の内側に入ったか」で見る。
 * 輪の面を横切ったかまで見ると、真横から入らないと通れず窮屈になるため。
 */

import Phaser from 'phaser';
import { RING_RADIUS, type Ring } from '../practice/stages';

/** 手描き風の揺らぎを作るときの分割数 */
const SEGMENTS = 44;

const INK = 0x241a12;
const NEXT = 0xd59a34;      // 次に潜る輪
const LATER = 0xf4e6c8;     // それ以降

export class Rings {
  /** まだ潜っていない輪。先頭が次に潜るもの */
  private rest: Ring[] = [];
  /** 輪ごとの揺らぎ。毎フレーム作り直すと形が踊るので一度だけ作る */
  private wobble = new Map<Ring, number[]>();
  private gfx: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.gfx = scene.add.graphics().setDepth(depth);
  }

  /** ステージを差し替える。番号は潜る順そのまま */
  load(rings: Ring[]): void {
    this.rest = [...rings];
    this.wobble.clear();
    for (const r of rings) {
      // 種から同じ揺らぎを作る。線がいつも同じ形にゆがむ
      const w: number[] = [];
      let a = r.seed >>> 0;
      for (let i = 0; i < SEGMENTS; i++) {
        a = (a * 1664525 + 1013904223) >>> 0;
        w.push(1 + ((a >>> 8) % 1000) / 1000 * 0.09 - 0.045);
      }
      this.wobble.set(r, w);
    }
    for (const t of this.labels) t.destroy();
    this.labels = rings.map((r, i) => this.scene.add.text(r.x, r.y, String(i + 1), {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '30px', color: '#f4e6c8',
      stroke: '#241a12', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(this.gfx.depth + 1));
  }

  get remaining(): number { return this.rest.length; }
  get cleared(): boolean { return this.rest.length === 0; }
  /** 次に潜る輪。全部潜り終えていれば null */
  get next(): Ring | null { return this.rest[0] ?? null; }

  /**
   * 機体が次の輪を潜ったかを見る。
   * 番号順でないと消えないので、見るのは先頭の1つだけでよい
   * @returns 潜ったら true
   */
  check(x: number, y: number): boolean {
    const r = this.rest[0];
    if (!r) return false;
    if (Math.hypot(x - r.x, y - r.y) > RING_RADIUS) return false;
    this.rest.shift();
    const idx = this.labels.findIndex((t) => Math.abs(t.x - r.x) < 0.01 && Math.abs(t.y - r.y) < 0.01);
    if (idx >= 0) {
      this.labels[idx].destroy();
      this.labels.splice(idx, 1);
    }
    return true;
  }

  draw(t: number): void {
    const g = this.gfx;
    g.clear();
    this.rest.forEach((r, i) => {
      const isNext = i === 0;
      const color = isNext ? NEXT : LATER;
      // 次の輪だけゆっくり脈打たせて、どれを狙うのか一目で分かるようにする
      const pulse = isNext ? 1 + Math.sin(t * 3.4) * 0.035 : 1;
      const w = this.wobble.get(r)!;

      const path = (scale: number): void => {
        g.beginPath();
        for (let s = 0; s <= SEGMENTS; s++) {
          const k = s % SEGMENTS;
          const a = (k / SEGMENTS) * Math.PI * 2;
          const rad = RING_RADIUS * w[k] * scale * pulse;
          const px = r.x + Math.cos(a) * rad;
          const py = r.y + Math.sin(a) * rad;
          if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
      };

      // 内側をうっすら埋めて「穴」に見せる。埋めないと空に線が浮くだけになる
      g.fillStyle(color, isNext ? 0.16 : 0.07);
      path(1);
      g.fillPath();

      // 輪郭はインクの線を2本。太い黒の上に色を乗せてペン画に寄せる
      g.lineStyle(9, INK, isNext ? 0.95 : 0.5);
      path(1.06);
      g.strokePath();
      g.lineStyle(5, color, isNext ? 1 : 0.55);
      path(1.06);
      g.strokePath();
    });

    this.labels.forEach((label, i) => {
      label.setColor(i === 0 ? '#ffd76b' : '#f4e6c8');
      label.setAlpha(i === 0 ? 1 : 0.5);
    });
  }

  destroy(): void {
    this.gfx.destroy();
    for (const t of this.labels) t.destroy();
    this.labels = [];
  }
}
