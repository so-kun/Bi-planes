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

import { ENGINE, FLIGHT, WEAPON, groundAt, shortestDx, wrapX } from '../config';
import type { AiLevel } from '../config';
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

/**
 * 引き起こしを始める余裕。
 *
 * 「今の高さ」だけで決めると、突っ込んでいる最中は手遅れになる。
 * 宙返りの半径が 135px ほどあるうえ、迷ってから動くまでの間もあるので、
 * 降下が速いほど早く引き起こす必要がある。
 * この秒数だけ先の高さを見て、そこが危なければ引く
 */
const GROUND_LOOKAHEAD = 1.1;
/** 先を読んだ位置が、地面からこれより近ければ引き起こす */
const GROUND_MARGIN = 150;
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
  /**
   * 水温が上がりすぎて、いま冷ましている最中か。
   * 計器を見て吹かすのをやめる ―― 人にできる判断しかさせない方針のとおり、
   * 見えない情報は使わない（水温は計器盤に出ている）
   */
  private cooling = false;

  constructor(private level: AiLevel) {}

  setLevel(level: AiLevel): void {
    this.level = level;
  }

  reset(): void {
    this.thinkTimer = 0;
    this.fireDelay = 0;
    this.wantFire = false;
    this.cooling = false;
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

    // 水温の見張り。赤帯で緩め、余裕ができるまで戻さない（戻す位置を下げて、
    // 赤帯のきわで入り切りを繰り返さないようにする）
    if (me.temp >= ENGINE.redline) this.cooling = true;
    else if (me.temp <= ENGINE.redline - 0.20) this.cooling = false;

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
    // 今いる高さではなく、少し先の高さで判断する。降下が速いほど早く引き起こす。
    // 地面は場所によって高さが違うので、行き先の x で見る
    const ahead = me.y + Math.max(0, s.vy) * GROUND_LOOKAHEAD;
    const aheadX = wrapX(me.x + s.vx * GROUND_LOOKAHEAD);
    if (ahead > groundAt(aheadX) - GROUND_MARGIN) {
      desired = Math.atan2(-0.95, forward * 0.5);   // 上へ逃げる
      urgent = true;
    } else if (me.readout.stalled && speed < FLIGHT.stallWarnSpeed) {
      desired = Math.atan2(0.75, forward * 0.7);    // 下を向いて速度を稼ぐ
      urgent = true;
    } else if (aim) {
      // 地面すれすれの相手を追って一緒に突っ込まないよう、狙う高さに底を設ける。
      // 撃つのを諦める代わりに墜ちない ―― 追い詰めるのは相手が上がってきてからでいい
      const aimY = Math.min(aim.y, groundAt(wrapX(aim.x)) - GROUND_MARGIN);
      // 画面の左右はつながっているので、近いほうの向きへ向く。
      // そのまま引き算すると、端をまたいだ相手を画面の反対側まで追いかけてしまう
      desired = Math.atan2(aimY - me.y, shortestDx(aim.x - me.x)) + this.jitterAngle;
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

    // 誤差が小さいうちは舵を緩める。全開のままだと目標を行き過ぎて左右に揺れる。
    // ただし地面や失速から逃げているときは緩めない ―― 加減している場合ではない
    let gain = urgent ? 1 : Math.min(1, Math.abs(err) / 0.25);

    // 失速させない。舵を引くと迎え角が増えるので、失速角に近づいたら緩める。
    // 速度で加減する手もあるが、失速を決めているのは迎え角そのものなので、
    // そちらを直接見るほうが効く。逆向き（迎え角を減らす向き）の舵は妨げない
    const aoa = me.readout.aoa;
    const limit = FLIGHT.stallAoa * 0.8;
    if (pull === Math.sign(aoa) && Math.abs(aoa) > limit) {
      gain *= Math.max(0, 1 - (Math.abs(aoa) - limit) / (FLIGHT.stallAoa - limit));
    }
    const pitch = pull * gain;

    // 引き金。狙いが乗っていて、届く距離にいるときだけ
    const dist = aim ? Math.hypot(shortestDx(aim.x - me.x), aim.y - me.y) : Infinity;
    // 地面や失速から逃げている間は、機首が相手ではなく逃げる方へ向いている。
    // このとき撃つと、あらぬ方向へ撃つことになる
    // 再出撃直後の相手には当たらないので撃たない。
    // ただし狙いは付け続ける ―― 無敵が切れたときに射線に乗っているように
    const ghost = target === foe && foe !== null && foe.invulnerable;
    const onTarget = !urgent && !ghost && aim !== null && Math.abs(err) < lv.aim;
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
      // 遅いか遠いときは吹かす。近づいたら緩めて、行き過ぎないようにする。
      // 逃げている最中は速度が要るので必ず吹かす。
      // ただし水温が赤帯に入ったら緩め、十分冷えるまで我慢する
      throttle: (urgent || speed < 215 || dist > 340) && !this.cooling,
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
      const d = Math.hypot(shortestDx(b.img.x - me.x), b.img.y - me.y);
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
    const t = Math.hypot(shortestDx(x - me.x), y - me.y) / WEAPON.mg.speed;
    return { x: x + vx * t * lead, y: y + vy * t * lead };
  }
}
