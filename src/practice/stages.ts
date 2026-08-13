/**
 * プラクティスのステージ。
 *
 * 輪の位置と順番は**毎回同じ**にする。乱数で毎回変えるとタイムを比べられず、
 * ハイスコアの意味がなくなるため。ステージ番号を種にした擬似乱数で組み立てて、
 * どの環境でも同じ配置になるようにしてある。
 *
 * 難しさは仕様どおり「輪の数」と「順番の厳しさ」の2つで上げる。
 * 輪の大きさは変えない。
 */

import { VIEW, PLANE } from '../config';

export const PRACTICE_STAGES = 10;

/** 輪の内側の半径。ここを機体の中心が通れば潜ったことになる */
export const RING_RADIUS = PLANE.width * 0.62;

/** 輪を置いてよい範囲。地面と天井、それに計器の表示を避ける */
const AREA = { x0: 165, x1: VIEW.width - 165, y0: 132, y1: VIEW.groundY - 108 };

export interface Ring {
  x: number;
  y: number;
  /** 輪の形を毎回同じに崩すための種。手描き風のゆがみに使う */
  seed: number;
}

export interface Stage {
  index: number;
  rings: Ring[];
}

/** 同じ種からは必ず同じ並びが出る擬似乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * ステージ番号（0 起点）から輪の並びを作る。
 *
 * 数は 3 個から 1 つずつ増えて最後は 12 個。
 * 順番の厳しさは「次にどれを選ぶか」で決める ―― やさしいステージは近い輪から、
 * 難しいステージは遠い輪から辿らせる。遠い輪へ飛ぶほど、
 * 大きく向きを変えて速度を管理する必要が出る
 */
export function makeStage(index: number): Stage {
  const rand = rng(0x51ce + index * 7919);
  const count = 3 + index;
  // 遠い輪を選ぶ割合。後半ほど順番が飛ぶ
  const farBias = index / (PRACTICE_STAGES - 1);

  // 置き場所は升目から選び、升の中で少しずらす。
  // 適当に撒いて重なりを弾く方式だと、輪が増えたときに置ききれず数が足りなくなる
  // 縦は入るぶんだけ。詰めすぎると輪どうしが重なって、どれが次か読めなくなる
  const minSpacing = RING_RADIUS * 2.3;
  const rows = Math.max(1, Math.min(3, Math.floor((AREA.y1 - AREA.y0) / minSpacing)));
  const cols = Math.max(2, Math.ceil(count / rows));
  const cellW = (AREA.x1 - AREA.x0) / cols;
  const cellH = (AREA.y1 - AREA.y0) / rows;

  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  // 同じ種からは同じ並びになる混ぜ方（Fisher-Yates）
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  // 升の中で動かせる幅。輪どうしが重ならないよう、半径ぶんは余らせる
  const jitterX = Math.max(0, cellW / 2 - RING_RADIUS * 1.08);
  const jitterY = Math.max(0, cellH / 2 - RING_RADIUS * 1.08);
  // 列ごとに上下へずらす。升目のままだと整列して見え、空に並べた感じが出ない
  const stagger = Math.min(cellH * 0.22, Math.max(0, (AREA.y1 - AREA.y0 - rows * RING_RADIUS * 2.1) / 2));

  const spots: Ring[] = cells.slice(0, count).map((cell) => {
    const col = cell % cols;
    const cx = AREA.x0 + (col + 0.5) * cellW;
    const cy = AREA.y0 + (Math.floor(cell / cols) + 0.5) * cellH + (col % 2 ? stagger : -stagger);
    return {
      x: cx + (rand() * 2 - 1) * jitterX,
      y: cy + (rand() * 2 - 1) * jitterY,
      seed: Math.floor(rand() * 1e6),
    };
  });

  // 潜る順に並べ替える。1つ目は左端（1P の出撃側）にいちばん近いものから
  const rings: Ring[] = [];
  const rest = [...spots];
  let cur = { x: 230, y: 380 };
  while (rest.length) {
    const sorted = [...rest].sort(
      (a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y),
    );
    // 近い順の並びから、後半のステージほど後ろ（遠いほう）を選ぶ
    const pick = Math.min(sorted.length - 1, Math.floor(farBias * (sorted.length - 1) * rand() * 1.6));
    const chosen = sorted[pick];
    rest.splice(rest.indexOf(chosen), 1);
    rings.push(chosen);
    cur = chosen;
  }

  return { index, rings };
}

/** 10 ステージぶんをまとめて作る */
export function allStages(): Stage[] {
  return Array.from({ length: PRACTICE_STAGES }, (_, i) => makeStage(i));
}

/** タイムの表示。1/100 秒まで */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}
