/**
 * フライトモデルの数値を確かめる。ブラウザを立ち上げずに調整できるようにするためのもの。
 *
 *   node tools/flight-probe.mjs
 *
 * 見るのは 3 つ:
 *   1. スロットル段階ごとの水平飛行の速度（想定: アイドルは維持できず沈む、巡航 約270、全開 約360）
 *   2. 失速する速度
 *   3. 急上昇 → 失速 → 立て直し、が成立するか
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(mkdtempSync(join(tmpdir(), 'flight-')), 'flight.mjs');
execFileSync('npx', ['esbuild', join(root, 'src/flight.ts'), '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { cwd: root });
const { stepFlight } = await import(pathToFileURL(out).href);

const DT = 1 / 60;

/** 高度を保つように舵を当てながら回し、落ち着いた速度を見る */
function levelFlight(throttle, seconds = 40) {
  const s = { x: 0, y: 360, vx: 270, vy: 0, pitch: 0, roll: 0, throttle };
  let last = null;
  for (let i = 0; i < seconds / DT; i++) {
    // 画面座標は下が正。低いほど（y が大きいほど）機首を上げる
    const input = Math.max(-1, Math.min(1, (s.y - 360) * 0.004 + s.vy * 0.02));
    last = stepFlight(s, { pitch: input }, DT);
  }
  return { speed: Math.round(last.speed), y: Math.round(s.y), aoa: +(last.aoa * 180 / Math.PI).toFixed(1) };
}

/** 舵を引き続けたときに失速する速度 */
function stallSpeed() {
  const s = { x: 0, y: 360, vx: 300, vy: 0, pitch: 0, roll: 0, throttle: 1 };
  for (let i = 0; i < 30 / DT; i++) {
    const r = stepFlight(s, { pitch: 1 }, DT);
    if (r.stalled) return Math.round(r.speed);
  }
  return null;
}

/** 急上昇 → 失速 → 舵を戻して立て直せるか */
function stallRecovery() {
  const s = { x: 0, y: 300, vx: 300, vy: 0, pitch: 0, roll: 0, throttle: 1 };
  let stalledAt = null, minSpeed = 1e9, maxY = 0;
  for (let i = 0; i < 12 / DT; i++) {
    const t = i * DT;
    // 3 秒引き続けてから舵を放す
    const r = stepFlight(s, { pitch: t < 3 ? 1 : 0 }, DT);
    if (r.stalled && stalledAt === null) stalledAt = +t.toFixed(2);
    minSpeed = Math.min(minSpeed, r.speed);
    maxY = Math.max(maxY, s.y);
    if (s.y > 700) return { stalledAt, minSpeed: Math.round(minSpeed), result: `地面に激突 (t=${t.toFixed(1)}s)` };
  }
  return {
    stalledAt,
    minSpeed: Math.round(minSpeed),
    lowestPoint: Math.round(maxY),
    endSpeed: Math.round(Math.hypot(s.vx, s.vy)),
    result: '立て直した',
  };
}

/** 舵を引き切って一周させ、宙返りの半径を測る */
function loopRadius(throttle = 1) {
  const s = { x: 0, y: 300, vx: 300, vy: 0, pitch: 0, roll: 0, throttle };
  let minX = 0, maxX = 0, minY = 300, maxY = 300, turned = 0, prev = 0;
  for (let i = 0; i < 8 / DT; i++) {
    stepFlight(s, { pitch: 1 }, DT);
    const ang = Math.atan2(s.vy, s.vx);
    let d = ang - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (i > 0) turned += d;
    prev = ang;
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    if (Math.abs(turned) > Math.PI * 2) {
      return { seconds: +(i * DT).toFixed(2), width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
    }
  }
  return { result: '一周できなかった（失速している）', width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
}

/** アイドルで緩やかに上昇し続けたとき、どこで速度を失って落ちはじめるか */
function slowClimb() {
  const s = { x: 0, y: 500, vx: 300, vy: 0, pitch: 0, roll: 0, throttle: 0 };
  let peakY = 500, minSpeed = 1e9, stalledAt = null;
  for (let i = 0; i < 20 / DT; i++) {
    // 30度ほどの上昇姿勢を保つように舵を当てる
    const want = -Math.PI / 6;
    const r = stepFlight(s, { pitch: Math.max(-1, Math.min(1, (s.pitch - want) * 3)) }, DT);
    if (r.stalled && stalledAt === null) stalledAt = { t: +(i * DT).toFixed(2), speed: Math.round(r.speed) };
    minSpeed = Math.min(minSpeed, r.speed);
    peakY = Math.min(peakY, s.y);
    if (s.y > 612) return { stalledAt, minSpeed: Math.round(minSpeed), peakY: Math.round(peakY), result: `${(i * DT).toFixed(1)}秒で地面へ` };
  }
  return { stalledAt, minSpeed: Math.round(minSpeed), peakY: Math.round(peakY), result: '20秒たっても落ちない' };
}

const names = ['アイドル', '巡航', '全開'];
console.log('■ 水平飛行');
for (let t = 0; t < 3; t++) {
  const r = levelFlight(t);
  const held = Math.abs(r.y - 360) < 40 ? '高度を維持' : r.y > 360 ? `沈む (y=${r.y})` : `上昇 (y=${r.y})`;
  console.log(`  ${names[t].padEnd(6, '　')} 速度 ${String(r.speed).padStart(4)}  迎え角 ${String(r.aoa).padStart(5)}°  ${held}`);
}
console.log('\n■ 失速');
console.log(`  舵を引き続けて失速に入る速度: ${stallSpeed()}`);
console.log('\n■ アイドルで上昇を続けたとき');
console.log(' ', JSON.stringify(slowClimb()));
console.log('\n■ 宙返り（舵を引き切って一周）');
console.log(' ', JSON.stringify(loopRadius()));
console.log('\n■ 急上昇からの立て直し');
console.log(' ', JSON.stringify(stallRecovery(), null, 0));

writeFileSync(join(tmpdir(), 'flight-probe-done'), 'ok');
