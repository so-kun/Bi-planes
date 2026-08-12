/**
 * コンピュータの操縦。
 *
 * 人と同じものしか出さない ―― 機首の引き具合・ロール・スロットル・引き金。
 * 機体の中身を直接いじらないので、人が勝てない動きにはならないし、
 * 失速も墜落も人と同じように起きる。
 *
 * 考え方は単純で、毎フレーム「機首をどっちへ向けたいか」を1つの角度に決め、
 * そこへ向けて舵を切るだけ。向けたい先の決め方に優先順位がある:
 *
 *   1. 地面が近い    → 上を向く（何を措いても墜ちない）
 *   2. 失速している  → 下を向いて速度を取り戻す
 *   3. それ以外      → 狙う相手（敵機か気球）の未来位置へ向ける
 *
 * ロールは飾りではなく、実機と同じ理由で使う。機首を回すのに「押す」より
 * 「引く」ほうが素直なので、押し続けることになる場面では背面に返して引きに変える。
 */

import { FLIGHT, VIEW, WEAPON } from '../config';
import type { Plane } from '../objects/Plane';
import type { Balloon } from '../objects/Balloons';
import { wrapPi } from '../flight';

/** 人の操作と同じ形。これを PlayScene が機体に渡す */
export interface Intent {
  pitch: number;
  rollEdge: -1 | 0 | 1;
  throttle: boolean;
  mg: boolean;
  cannonEdge: boolean;
}

const IDLE: Intent = { pitch: 0, rollEdge: 0, throttle: false, mg: false, cannonEdge: false };

export interface Level {
  name: string;
  /** 引き金を引く狙いの許容範囲（ラジアン）。狭いほど正確 */
  aim: number;
  /** 迷ってから動くまでの間（秒）。長いほど鈍い */
  react: number;
  /** 未来位置の読みの正確さ。0 なら現在位置を撃つ */
  lead: number;
  /** 狙いに乗せる揺らぎ（ラジアン）。大きいほど下手 */
  jitter: number;
  /** 7.7mm を撃ちはじめる距離。射程に対する割合 */
  mgRange: number;
  /** 20mm を使うか */
  cannon: boolean;
}

/** 切 / 弱 / 普通 / 強。切は先頭に置いて、番号 0 = 人が操縦とそろえる */
export const AI_LEVELS: Level[] = [
  { name: '弱', aim: 0.17, react: 0.50, lead: 0.35, jitter: 0.26, mgRange: 0.55, cannon: false },
  { name: '普通', aim: 0.10, react: 0.26, lead: 0.80, jitter: 0.11, mgRange: 0.85, cannon: true },
  { name: '強', aim: 0.06, react: 0.10, lead: 1.00, jitter: 0.03, mgRange: 1.00, cannon: true },
];

/** 地面からこの距離まで近づいたら、何を措いても引き起こす */
const GROUND_MARGIN = 190;
/** 押し続けることになるなら背面に返す、と判断する角度 */
const ROLL_THRESHOLD = 0.7;
/** 20mm を撃つ距離。山なりに落ちるので、当たるのは近くだけ */
const CANNON_RANGE = 360;

export class Pilot {
  private thinkTimer = 0;
  private jitterAngle = 0;
  /** 引き金を引くと決めてから実際に引くまでの間 */
  private fireDelay = 0;
  private wantFire = false;

  constructor(private level: Level) {}

  setLevel(level: Level): void {
    this.level = level;
  }

  reset(): void {
    this.thinkTimer = 0;
    this.fireDelay = 0;
    this.wantFire = false;
  }

  /**
   * @param me       操縦する機
   * @param foe      相手の機。撃墜されている間は null
   * @param balloons 空にある気球
   */
  think(me: Plane, foe: Plane | null, balloons: Balloon[], dt: number): Intent {
    if (!me.alive) {
      this.reset();
      return IDLE;
    }

    const lv = this.level;
    const s = me.state;
    const speed = Math.hypot(s.vx, s.vy);

    // 迷いの間。毎フレーム狙いを付け直すと、人には出せない精度で機体が振れる
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = lv.react;
      this.jitterAngle = (Math.random() - 0.5) * 2 * lv.jitter;
    }

    const target = this.pickTarget(me, foe, balloons);
    const aim = target ? this.leadPoint(me, target, lv.lead) : null;

    // 機首を向けたい角度を決める。地面と失速が最優先
    const forward = Math.cos(s.pitch) >= 0 ? 1 : -1;
    let desired: number;
    let urgent = false;
    if (me.y > VIEW.groundY - GROUND_MARGIN && s.vy > -40) {
      desired = Math.atan2(-0.95, forward * 0.5);   // 上へ逃げる
      urgent = true;
    } else if (me.readout.stalled && speed < FLIGHT.stallWarnSpeed) {
      desired = Math.atan2(0.75, forward * 0.7);    // 下を向いて速度を稼ぐ
      urgent = true;
    } else if (aim) {
      desired = Math.atan2(aim.y - me.y, aim.x - me.x) + this.jitterAngle;
    } else {
      desired = Math.atan2(0, forward);             // 目標がなければ水平に流す
    }

    const err = wrapPi(desired - s.pitch);

    // 舵の向き。機体は入力を「機体基準」で受けるので、背面では画面上の向きが逆になる。
    // 機首の回る向きは -input * upSign なので、誤差を詰める入力はこの符号になる
    const upSign = Math.cos(s.roll) >= 0 ? 1 : -1;
    const pull = -Math.sign(err) * upSign;

    // 押し続けることになるなら背面に返して「引き」に変える。実機と同じ理由。
    // ただし地面や失速から逃げている最中は、回っている余裕がないので我慢する
    let rollEdge: -1 | 0 | 1 = 0;
    if (!urgent && pull < 0 && Math.abs(err) > ROLL_THRESHOLD && !me.rolling) {
      rollEdge = 1;
    }

    // 誤差が小さいうちは舵を緩める。全開のままだと目標を行き過ぎて左右に揺れる
    const gain = Math.min(1, Math.abs(err) / 0.25);
    const pitch = pull * gain;

    // 引き金。狙いが乗っていて、届く距離にいるときだけ
    const dist = aim ? Math.hypot(aim.x - me.x, aim.y - me.y) : Infinity;
    const onTarget = aim !== null && Math.abs(err) < lv.aim;
    const inMgRange = dist < WEAPON.mg.speed * WEAPON.mg.life * lv.mgRange;
    const wants = onTarget && inMgRange;

    // 撃つと決めてから実際に引くまでの間を置く。反射で撃たれると理不尽に感じる
    if (wants && !this.wantFire) this.fireDelay = lv.react * 0.6;
    this.wantFire = wants;
    this.fireDelay = Math.max(0, this.fireDelay - dt);
    const firing = wants && this.fireDelay <= 0;

    const useCannon = firing && lv.cannon && foe !== null && target === foe
      && dist < CANNON_RANGE && Math.abs(err) < lv.aim * 0.7;

    return {
      pitch,
      rollEdge,
      // 遅いか遠いときは吹かす。近づいたら緩めて、行き過ぎないようにする
      throttle: speed < 215 || dist > 340,
      mg: firing && !useCannon,
      cannonEdge: useCannon,
    };
  }

  /**
   * 狙う相手を選ぶ。基本は敵機。
   * 敵機がいない（撃墜されている）ときと、傷んでいて金色の気球が浮いているときは気球へ向かう
   */
  private pickTarget(me: Plane, foe: Plane | null, balloons: Balloon[]): Plane | Balloon | null {
    const hurt = me.hp < 60 || me.damage.engine < 0.85 || me.damage.handling < 0.85;
    const gold = balloons.find((b) => b.gold);
    if (hurt && gold) return gold;
    if (foe) return foe;

    let best: Balloon | null = null;
    let bestD = Infinity;
    for (const b of balloons) {
      const d = Math.hypot(b.img.x - me.x, b.img.y - me.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** 弾が届くころに相手がいる場所。lead が小さいほど読みが甘くなる */
  private leadPoint(me: Plane, target: Plane | Balloon, lead: number): { x: number; y: number } {
    const isPlane = 'state' in target;
    const x = isPlane ? target.x : target.img.x;
    const y = isPlane ? target.y : target.img.y;
    const vx = isPlane ? target.state.vx : 0;
    const vy = isPlane ? target.state.vy : target.vy;
    const t = Math.hypot(x - me.x, y - me.y) / WEAPON.mg.speed;
    return { x: x + vx * t * lead, y: y + vy * t * lead };
  }
}
