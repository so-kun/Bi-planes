/**
 * プラクティスのステージ。
 *
 * 配置と順番は**全ステージ手で組んである**。乱数で作ると
 * 「この配置ならこの機動」という狙いが作れないし、タイムも比べられない。
 *
 * 輪には**くぐる向き**がある。輪の面を、決められた向きに横切ったときだけ通過になる。
 * 上から乗っても、逆向きに抜けても通らない。この制約があるおかげで、
 * 「次の輪へどの向きで入るか」を逆算して飛ぶ必要が生まれ、練習になる。
 *
 * 狙いは、進むにつれて次の機動が要るようにすること:
 *   上昇と下降 → 折り返し → 宙返り → インメルマンターン → スプリットS → 組み合わせ
 */

import { VIEW, PLANE } from '../config';

/** 輪の開口部の半径（長いほうの半径）。ここを機体が横切れば通過 */
export const RING_RADIUS = PLANE.width * 0.80;
/** 輪を横から見たときの潰れ具合。小さいほど「横向きの輪」に見える */
export const RING_SQUASH = 0.30;

/** くぐる向き。画面座標なので下が正 */
const R = 0;                 // 右へ抜ける
const L = Math.PI;           // 左へ抜ける
const U = -Math.PI / 2;      // 上へ抜ける
const D = Math.PI / 2;       // 下へ抜ける
const RU = -Math.PI / 4;     // 右上へ
const RD = Math.PI / 4;      // 右下へ
const LU = -Math.PI * 3 / 4; // 左上へ
const LD = Math.PI * 3 / 4;  // 左下へ

export interface Ring {
  x: number;
  y: number;
  /** くぐる向き（ラジアン）。この向きに面を横切ったときだけ通過 */
  dir: number;
}

export interface Stage {
  /** ステージの狙い。開始時に出す */
  name: string;
  rings: Ring[];
}

const ring = (x: number, y: number, dir: number): Ring => ({ x, y, dir });

/**
 * 全10ステージ。機体は毎回 (230, 380) から右向きに出る。
 *
 * 画面は左右がつながっている（右端を出ると左端から出てくる）ので、
 * 折り返しは「宙返りで戻る」か「画面を一周する」かを選べる。
 * 近い折り返しは宙返りのほうが速い ―― そこが練習になる。
 */
export const STAGES: Stage[] = [
  // 1. まっすぐ飛んで、上げて下げるだけ
  {
    name: '上昇と下降',
    rings: [ring(620, 300, R), ring(1010, 470, R)],
  },

  // 2. 振れ幅を大きく。速度を落とさずに登る／降りるを覚える
  {
    name: '高度を変える',
    rings: [ring(560, 470, R), ring(850, 210, R), ring(1130, 430, R)],
  },

  // 3. 最後だけ左向き。初めての折り返し
  {
    name: '折り返す',
    rings: [ring(640, 360, R), ring(1000, 330, R), ring(660, 170, L)],
  },

  // 4. 3つ目が2つ目の「後ろ」にあって同じ右向き。
  //    一周して戻るしかない ＝ 宙返り。画面を回っても行けるが宙返りのほうが速い
  {
    name: '宙返り',
    rings: [ring(560, 430, R), ring(980, 430, R), ring(700, 430, R)],
  },

  // 5. 高いところを右へ抜けたあと、低いところを左へ。
  //    背面に返して降りながら回る ＝ スプリットS
  {
    name: 'スプリットS',
    rings: [ring(560, 200, R), ring(920, 190, R), ring(700, 460, L)],
  },

  // 6. 低いところを右へ抜けたあと、高いところを左へ。
  //    登りながら回って背面を戻す ＝ インメルマンターン
  {
    name: 'インメルマンターン',
    rings: [ring(520, 490, R), ring(900, 490, R), ring(660, 200, L)],
  },

  // 7. 折り返しを2回。左右に振られる
  {
    name: '八の字',
    rings: [
      ring(540, 430, R), ring(940, 390, R),
      ring(700, 190, L), ring(330, 220, L),
      ring(600, 440, R),
    ],
  },

  // 8. ひと回りする輪郭。機体が実際に描ける輪の大きさに合わせて置いてある
  //    （宙返りは 206x321px なので、上下の差を 320px、折り返しの幅を 200px 前後にする）。
  //    輪の向きが道順そのものになっているので、辿れば一周できる
  {
    name: 'ひと回り',
    rings: [
      ring(520, 490, R), ring(860, 490, R),
      ring(1080, 330, U), ring(860, 170, L),
      ring(520, 170, L), ring(300, 330, D),
    ],
  },

  // 9. ひと回りしたあと、下の直線へ入り直して登って抜ける
  {
    name: '連続旋回',
    rings: [
      ring(520, 490, R), ring(860, 490, R),
      ring(1080, 330, U), ring(860, 170, L),
      ring(520, 170, L), ring(300, 330, D),
      ring(620, 490, R), ring(1000, 440, RU),
    ],
  },

  // 10. 総仕上げ。下の直線で宙返り（4番目と同じ形）を挟んでから一周する。
  //     輪はどれも重ならない位置に置いてある ―― 同じ場所を二度くぐる形にすると、
  //     番号が重なってどちらを狙うのか読めなくなる
  {
    name: '総仕上げ',
    rings: [
      ring(420, 500, R), ring(760, 500, R), ring(1060, 500, R),
      ring(860, 500, R),
      ring(1120, 330, U), ring(880, 170, L), ring(560, 170, L),
      ring(280, 330, D),
      ring(520, 500, R), ring(900, 330, RU),
    ],
  },
];

export const PRACTICE_STAGES = STAGES.length;

/** 出撃位置。全ステージ共通 */
export const START = { x: 230, y: 380, facing: 1 as const };

/** 輪が画面からはみ出していないかの確認用（テストと開発時に使う） */
export function outOfBounds(): string[] {
  const bad: string[] = [];
  STAGES.forEach((s, i) => {
    s.rings.forEach((r, j) => {
      if (r.x < RING_RADIUS || r.x > VIEW.width - RING_RADIUS
        || r.y < RING_RADIUS + 40 || r.y > VIEW.groundY - RING_RADIUS) {
        bad.push(`ステージ${i + 1} の ${j + 1}番目 (${r.x}, ${r.y})`);
      }
    });
  });
  return bad;
}

/** タイムの表示。1/100 秒まで */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}

export { R, L, U, D, RU, RD, LU, LD };
