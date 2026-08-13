/**
 * プラクティスの輪。番号の順に、決められた向きにくぐる。
 *
 * 輪は「横向きに置かれた輪」に見えるよう、くぐる向きに潰した楕円で描く。
 * 潰れている方向がそのまま「入る向き」を表すので、形を見れば
 * どちらから入ればよいかが分かる。矢印も添えてある。
 *
 * 通過の判定は**輪の面を横切ったか**で見る。上から乗せても、逆向きに抜けても通らない。
 * 位置だけで見ると輪の中に入り込めば通ってしまい、横から潜る意味がなくなるため、
 * 前のフレームと今のフレームを結んだ線分が面を越えたかで判断する
 * （速く飛んでも飛び越さない）。
 */

import Phaser from 'phaser';
import { RING_RADIUS, RING_SQUASH, type Ring } from '../practice/stages';

/** 手描き風の揺らぎを作るときの分割数 */
const SEGMENTS = 44;

const INK = 0x241a12;
const NEXT = 0xd59a34;      // 次にくぐる輪
const LATER = 0xf4e6c8;     // それ以降

export class Rings {
  /** まだくぐっていない輪。先頭が次にくぐるもの */
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

  /** ステージを差し替える。番号はくぐる順そのまま */
  load(rings: Ring[]): void {
    this.rest = [...rings];
    this.wobble.clear();
    rings.forEach((r, i) => {
      // 位置と番号から同じ揺らぎを作る。線がいつも同じ形にゆがむ
      const w: number[] = [];
      let a = (Math.round(r.x) * 73856093 ^ Math.round(r.y) * 19349663 ^ (i + 1) * 83492791) >>> 0;
      for (let s = 0; s < SEGMENTS; s++) {
        a = (a * 1664525 + 1013904223) >>> 0;
        w.push(1 + ((a >>> 8) % 1000) / 1000 * 0.10 - 0.05);
      }
      this.wobble.set(r, w);
    });

    for (const t of this.labels) t.destroy();
    this.labels = rings.map((r, i) => this.scene.add.text(r.x, r.y, String(i + 1), {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '28px', color: '#f4e6c8',
      stroke: '#241a12', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(this.gfx.depth + 1));
  }

  get remaining(): number { return this.rest.length; }
  get cleared(): boolean { return this.rest.length === 0; }
  /** 次にくぐる輪。全部くぐり終えていれば null */
  get next(): Ring | null { return this.rest[0] ?? null; }

  /**
   * 前の位置から今の位置へ動く間に、次の輪をくぐったかを見る。
   * 番号順でないと消えないので、見るのは先頭の1つだけでよい。
   *
   * 輪の面を「決められた向きに」越え、かつ越えた点が開口部の中に
   * 収まっているときだけ通過とする
   */
  check(px: number, py: number, x: number, y: number): boolean {
    const r = this.rest[0];
    if (!r) return false;

    const ax = Math.cos(r.dir);
    const ay = Math.sin(r.dir);
    // 面までの符号つき距離。手前が負、通り抜けた先が正
    const before = (px - r.x) * ax + (py - r.y) * ay;
    const after = (x - r.x) * ax + (y - r.y) * ay;
    if (before >= 0 || after < 0) return false;   // 逆向き、または越えていない

    // 面を越えた瞬間の位置を線分から求め、開口部の中かを見る
    const t = before === after ? 0 : before / (before - after);
    const cx = px + (x - px) * t;
    const cy = py + (y - py) * t;
    const lateral = (cx - r.x) * -ay + (cy - r.y) * ax;
    if (Math.abs(lateral) > RING_RADIUS) return false;

    // 輪と番号は同じ並びで持っているので、先頭どうしを一緒に外す。
    // 位置で探すと、同じ場所を2度くぐるコースで取り違える
    this.rest.shift();
    this.labels.shift()?.destroy();
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

      // くぐる向きに潰す。潰れている方向が「入る向き」
      const ax = Math.cos(r.dir);
      const ay = Math.sin(r.dir);

      const path = (scale: number): void => {
        g.beginPath();
        for (let s = 0; s <= SEGMENTS; s++) {
          const k = s % SEGMENTS;
          const a = (k / SEGMENTS) * Math.PI * 2;
          const rad = RING_RADIUS * w[k] * scale * pulse;
          // 開口部は面に沿った向きへ広く、くぐる向きへ狭く
          const along = Math.cos(a) * rad * RING_SQUASH;
          const across = Math.sin(a) * rad;
          const px = r.x + ax * along - ay * across;
          const py = r.y + ay * along + ax * across;
          if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
      };

      // 内側をうっすら埋めて「穴」に見せる
      g.fillStyle(color, isNext ? 0.16 : 0.07);
      path(1);
      g.fillPath();

      // 輪郭はインクの線を2本。太い黒の上に色を乗せてペン画に寄せる
      g.lineStyle(9, INK, isNext ? 0.95 : 0.5);
      path(1.05);
      g.strokePath();
      g.lineStyle(5, color, isNext ? 1 : 0.55);
      path(1.05);
      g.strokePath();

      // 入る向きの矢印。輪の手前から中心へ向けて引く
      const tail = RING_RADIUS * 1.05;
      const head = RING_RADIUS * 0.32;
      const x0 = r.x - ax * tail;
      const y0 = r.y - ay * tail;
      const x1 = r.x - ax * head;
      const y1 = r.y - ay * head;
      g.lineStyle(7, INK, isNext ? 0.8 : 0.35);
      g.lineBetween(x0, y0, x1, y1);
      g.lineStyle(3.5, color, isNext ? 0.95 : 0.45);
      g.lineBetween(x0, y0, x1, y1);
      for (const side of [1, -1]) {
        const a = r.dir + Math.PI + side * 0.55;
        g.lineStyle(3.5, color, isNext ? 0.95 : 0.45);
        g.lineBetween(x1, y1, x1 + Math.cos(a) * 17, y1 + Math.sin(a) * 17);
      }
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
