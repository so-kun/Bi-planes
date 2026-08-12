/**
 * 調整用の数値をここに集める。
 * プレイテストで触るのはほぼこのファイルだけになるようにしておく。
 * 長さの単位は論理解像度 1280x720 上の px、時間は秒。
 */

export const VIEW = {
  width: 1280,
  height: 720,
  /** 地面の高さ。背景の山の稜線に合わせてある */
  groundY: 612,
  /** これより上には出られない（雲より上は薄すぎて飛べない、という扱い） */
  ceilingY: -40,
};

export const PLANE = {
  /** 表示幅（画面幅の 8%） */
  width: VIEW.width * 0.08,
  /** 当たり判定の半径 */
  hitRadius: VIEW.width * 0.026,
  /** 180度ロールにかける秒数 */
  rollDuration: 0.45,
  /** リスポーンまでの秒数 */
  respawnDelay: 2.4,
  maxHp: 100,
};

/**
 * 自作フライトモデルの係数。
 * 揚力 L = LIFT_SCALE * v^2 * CL(迎え角)、抗力 D = DRAG_SCALE * v^2 * CD。
 * 迎え角が STALL_AOA を超えると CL が急落する ＝ 失速。
 */
export const FLIGHT = {
  /**
   * 重力と揚力の大きさは、宙返りの半径が画面に対して見栄えする大きさになるように決めてある。
   * 速度 270px/秒 で半径 200px 前後。これより揚力を強くすると機体より小さい輪で回ってしまう
   */
  gravity: 320,
  /** スロットル段階ごとの推力（加速度） */
  thrust: [40, 96, 150],
  liftScale: 0.015,
  /** 迎え角 1 ラジアンあたりの揚力係数 */
  liftPerAoa: 3.2,
  /** 失速する迎え角（約15度） */
  stallAoa: 0.26,
  /** 失速後にどれだけ揚力が落ちるか（0〜1） */
  stallLoss: 0.82,
  dragScale: 0.030,
  /** 形状抗力 */
  dragBase: 0.035,
  /** 誘導抗力（揚力を出すほど増える） */
  dragInduced: 0.055,
  /** 失速中に増える抗力 */
  dragStall: 0.9,
  /**
   * 操縦桿の効き（ラジアン/秒）。
   * 風見安定との比が、舵を引き切ったときの迎え角を決める:
   *   迎え角 ≒ pitchRate * controlRefSpeed / (weathervane * 速度)
   * この比が 0.25 だと、速いうちは失速せずに曲がれて、遅くなると失速する
   */
  pitchRate: 2.8,
  /** 舵が完全に効く速度。これを下回ると操縦が鈍る */
  controlRefSpeed: 240,
  /** 舵の効きの下限。失速中でもわずかには動かせる */
  minControl: 0.16,
  /** 機首が進行方向へ戻ろうとする強さ（風見安定） */
  weathervane: 4.0,
  /** 速度がこれ以下だと機首方向を進行方向とみなす（ゼロ割り回避） */
  minSpeed: 8,
  /** 失速警告を出す速度 */
  stallWarnSpeed: 175,
};

export const WEAPON = {
  mg: {
    speed: 1500,
    /** 寿命 x 弾速 = 射程。画面幅の約 60% */
    life: 0.51,
    gravity: 0,
    damage: 15,
    /** 連射間隔 */
    interval: 0.09,
    spread: 0.02,
  },
  cannon: {
    speed: 600,
    /** 画面幅の約 37% */
    life: 0.80,
    gravity: 430,
    damage: 100,
    /** 装填にかかる秒数 */
    interval: 2.5,
    spread: 0,
    /** 携行弾数 */
    ammo: 5,
  },
};

export const BALLOON = {
  width: VIEW.width * 0.075,
  /** 出現間隔の範囲 */
  spawnMin: 8,
  spawnMax: 20,
  riseMin: 34,
  riseMax: 54,
  score: 1,
  /** 同時に浮かべる上限 */
  maxAlive: 3,
};

export const SCORE = {
  balloon: 1,
  kill: 3,
  /** 相手の自滅 */
  suicide: 1,
  winning: 10,
};

/**
 * フィルム風ポストエフェクトの強度。
 * 既定は「弱」と「標準」の中間。ゲートウィーブだけは強度と連動させない。
 */
export const FILM_PRESETS = [
  { blur: 0,    sat: 1,    sepia: 0,    contrast: 1,    grain: 0,    flicker: 0,    weave: 0,    halo: 0    },
  { blur: 0.30, sat: 0.95, sepia: 0.06, contrast: 0.99, grain: 0.15, flicker: 0.02, weave: 0.35, halo: 0.5  },
  { blur: 0.42, sat: 0.915, sepia: 0.095, contrast: 0.975, grain: 0.215, flicker: 0.03, weave: 0.35, halo: 0.75 },
  { blur: 0.55, sat: 0.88, sepia: 0.13, contrast: 0.96, grain: 0.28, flicker: 0.04, weave: 0.35, halo: 1    },
  { blur: 0.90, sat: 0.76, sepia: 0.24, contrast: 0.91, grain: 0.44, flicker: 0.07, weave: 0.35, halo: 1.5  },
];
export const FILM_DEFAULT = 2;
/** エフェクト層の更新レート。絵は 60fps でも粒だけ古いコマ速で動かす */
export const FILM_FPS = 24;

export const SMOKE = {
  /** 通常飛行の白い航跡 */
  trailInterval: 0.06,
  trailLife: [3.6, 5.4] as const,
  trailSize: [0.19, 0.26] as const,   // 機体幅に対する比
  trailAlpha: 0.38,
  /** 被弾の黒煙 */
  damageInterval: 0.12,
  damageLife: [2.1, 2.9] as const,
  damageSize: [0.42, 0.62] as const,
  damageAlpha: 0.9,
};
