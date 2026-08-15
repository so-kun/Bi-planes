/**
 * 自作フライトモデル。
 *
 * 汎用物理エンジンは剛体と衝突の専門家で、揚力や失速は扱えない。
 * この手の 2D 空戦ゲームでは飛行の力学だけを自前で持つほうが、
 * 操作感のチューニングが素直にできる。
 *
 * 毎フレーム 4 つの力を積分する:
 *   推力 … 機首方向へ。スロットル段階で決まる
 *   重力 … 常に下向き
 *   揚力 … 速度に垂直。対気速度の 2 乗と迎え角に比例し、失速すると急落する
 *   抗力 … 速度と逆向き。速度の 2 乗に比例し、揚力を出すほど、また失速中ほど増える
 *
 * これで「急上昇 → 速度低下 → 失速 → 機首が落ちる → 速度回復で立て直す」
 * という本家の駆け引きが、特別な場合分けなしに自然に出る。
 */

import { FLIGHT } from './config';
import { settings } from './settings';

/** -π..π に畳む */
export function wrapPi(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
}

export interface FlightState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 機首方向（ラジアン、画面座標。0 = 右、正 = 画面下向き） */
  pitch: number;
  /** ロール角。0 = 正立、π = 背面 */
  roll: number;
  /** スロットル段階 0..2 */
  throttle: number;
}

export interface FlightInput {
  /** +1 = 機首上げ（操縦桿を引く）、-1 = 機首下げ。機体基準なので背面では画面上の向きが逆になる */
  pitch: number;
}

export interface FlightReadout {
  speed: number;
  /** 迎え角。正 = 機首が進行方向より上を向いている */
  aoa: number;
  stalled: boolean;
  /** 揚力係数。HUD やデバッグ表示用 */
  cl: number;
}

/** 迎え角から揚力係数を求める。失速角を超えると急落させる */
function liftCoeff(aoa: number): number {
  const { liftPerAoa, stallAoa, stallLoss } = FLIGHT;
  const a = Math.abs(aoa);
  let cl: number;
  if (a <= stallAoa) {
    cl = liftPerAoa * a;
  } else {
    // 失速。迎え角をさらに増やしても揚力は戻らない
    const over = Math.min(1, (a - stallAoa) / (stallAoa * 1.3));
    cl = liftPerAoa * stallAoa * (1 - stallLoss * over);
  }
  return Math.sign(aoa) * cl;
}

/**
 * 舵の効き。速度が落ちるほど鈍る。
 * 速度に比例させると揚力の項も同じだけ落ちてしまい、いくら遅くなっても
 * 迎え角が失速角に届かない。平方根で落とすことで、低速でだけ失速に入るようになる
 */
function controlAuthority(speed: number): number {
  const r = Math.sqrt(Math.max(0, speed) / FLIGHT.controlRefSpeed);
  return Math.max(FLIGHT.minControl, Math.min(1.1, r));
}

/**
 * 1 ステップ進める。state を書き換え、計器の値を返す。
 *
 * 向きの扱いは実機と同じにしてある。機体は宙返り（ピッチ）とロールしかできないので、
 * 右へ飛んでいた機が宙返りで左向きになると背面になり、正立に戻すにはロールが要る。
 * ロール操作が飾りではなく必須の操作になるのはこのため。
 * @param damageFactor 被弾による性能低下。エンジンと舵の効きに掛ける（1 = 無傷）
 * @param fullThrust   全開のときの推力。省略するとオプションで選んだ値。
 *                     **明示して渡せるようにしてあるのは、設定を変えずに測るため** ――
 *                     オプションの「速度」表示と `tools/flight-probe.mjs` がこれを使う
 */
export function stepFlight(
  state: FlightState,
  input: FlightInput,
  dt: number,
  damageFactor: { engine: number; handling: number } = { engine: 1, handling: 1 },
  fullThrust: number = settings.thrust,
): FlightReadout {
  const speed = Math.hypot(state.vx, state.vy);
  const moving = speed > FLIGHT.minSpeed;
  const velAngle = moving ? Math.atan2(state.vy, state.vx) : state.pitch;

  // 進行方向の単位ベクトル
  const ux = moving ? state.vx / speed : Math.cos(state.pitch);
  const uy = moving ? state.vy / speed : Math.sin(state.pitch);

  // 機体の「背中側」の向き。進行方向を -90 度回した先が正立時の上。
  // 背面ではこれが反転する。
  // ロールの途中（真横を向いた瞬間）は画面内に働く揚力が 0 になるので、
  // 大きさには |cos(roll)| を掛ける ―― ロールすると高度を失うのはこのため
  const rollCos = Math.cos(state.roll);
  const upSign = rollCos >= 0 ? 1 : -1;
  const upx = uy * upSign;
  const upy = -ux * upSign;
  const liftFactor = Math.abs(rollCos);

  // 迎え角: 機首が背中側へどれだけ傾いているか。正なら揚力が出る
  const nx = Math.cos(state.pitch);
  const ny = Math.sin(state.pitch);
  const aoa = Math.atan2(nx * upx + ny * upy, nx * ux + ny * uy);
  const stalled = Math.abs(aoa) > FLIGHT.stallAoa;

  // --- 操縦 ---
  // 機体基準。操縦桿を引くと機首は背中側へ向く。背面では画面上の上下が入れ替わる
  const authority = controlAuthority(speed) * damageFactor.handling;
  state.pitch -= input.pitch * upSign * FLIGHT.pitchRate * authority * dt;

  // 風見安定。機首は進行方向へ戻ろうとする。
  // 失速からの回復（機首が落ちて速度が戻る）はこの力が作る。
  // 効きは速度の平方根にし、下限も設ける ―― 速度に比例させると、ほぼ止まった機体では
  // 機首がまったく戻らず、空中で立ち往生して操縦不能に見えてしまうため
  if (moving) {
    const align = wrapPi(velAngle - state.pitch);
    const factor = Math.max(FLIGHT.minWeathervane, Math.sqrt(Math.min(1, speed / FLIGHT.controlRefSpeed)));
    state.pitch += align * FLIGHT.weathervane * factor * dt;
  }
  state.pitch = wrapPi(state.pitch);

  // --- 力 ---
  const q = speed * speed;
  const cl = liftCoeff(aoa);
  const lift = FLIGHT.liftScale * q * cl * liftFactor;

  let cd = FLIGHT.dragBase + FLIGHT.dragInduced * cl * cl;
  if (stalled) cd += FLIGHT.dragStall * (Math.abs(aoa) - FLIGHT.stallAoa);
  const drag = FLIGHT.dragScale * q * cd;

  // 全開の推力だけオプションで変えられる。巡航は据え置き
  const power = state.throttle > 0 ? fullThrust : FLIGHT.thrust[0];
  const thrust = power * damageFactor.engine;

  const ax = thrust * nx - drag * ux + lift * upx;
  const ay = thrust * ny - drag * uy + lift * upy + FLIGHT.gravity;

  state.vx += ax * dt;
  state.vy += ay * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  return { speed, aoa, stalled, cl };
}

/** 落ち着いた速度の計算結果。同じ推力を何度も聞かれるので覚えておく */
const levelSpeeds = new Map<number, number>();

/**
 * その推力で水平飛行を続けたときに落ち着く速度。
 *
 * オプション画面で「全開のパワー」を選ぶときに、速度で見せるために使う。
 * **表を手で書き写さない**ためのもの ―― 書き写すと、飛びの数値をいじったときに
 * 表示だけが古いまま残る。高度を保つように舵を当てながら回して、行き着く先を見る
 */
export function levelSpeed(fullThrust: number): number {
  const known = levelSpeeds.get(fullThrust);
  if (known !== undefined) return known;

  const dt = 1 / 60;
  const state: FlightState = { x: 0, y: 360, vx: 270, vy: 0, pitch: 0, roll: 0, throttle: 1 };
  let readout: FlightReadout = { speed: 0, aoa: 0, stalled: false, cl: 0 };
  for (let i = 0; i < 40 / dt; i++) {
    // 画面座標は下が正。低いほど（y が大きいほど）機首を上げる
    const hold = Math.max(-1, Math.min(1, (state.y - 360) * 0.004 + state.vy * 0.02));
    readout = stepFlight(state, { pitch: hold }, dt, undefined, fullThrust);
  }
  const speed = Math.round(readout.speed);
  levelSpeeds.set(fullThrust, speed);
  return speed;
}
