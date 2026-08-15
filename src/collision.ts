/**
 * 当たり判定の道具。
 *
 * 弾は速いので、**その瞬間の位置だけを見ると当たらない**。
 * 7.7mm は 1500px/秒 ＝ 60fps でも 1 フレームに 25px 進み、機体の判定半径（33px）に
 * 対して無視できない。フレームが落ちればさらに飛ぶ ―― 20fps なら 75px で、
 * 機体をまたいで通り抜ける。
 *
 * そこで**前のフレームと今のフレームを結んだ線分**で見る。輪くぐりの判定
 * （`src/objects/Rings.ts`）が同じ考え方で、あちらは「面を横切ったか」、
 * ここは「円に触れたか」。
 *
 * 相手も動いているので、線分は**相手から見た動き**（弾の動き − 相手の動き）で作る。
 * こうすると相手を原点に止めた1つの線分に落ちて、正面からすれ違う速い当たりも取れる。
 */

/**
 * 原点にある半径 r の円と、(x0,y0) から (x1,y1) への線分。
 *
 * @returns 触れていれば、いちばん近づく瞬間の位置（0〜1、線分上の割合）。触れていなければ null
 */
export function sweepHit(
  x0: number, y0: number, x1: number, y1: number, r: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  // ほとんど動いていないフレームは点で見る（0 割りを避ける）
  let t = len2 < 1e-9 ? 0 : -(x0 * dx + y0 * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x0 + dx * t;
  const cy = y0 + dy * t;
  return cx * cx + cy * cy <= r * r ? t : null;
}
