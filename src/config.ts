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
  /**
   * 上限の高度。機体が画面から消えないよう、姿が見える位置で止める。
   * softCeilingY から上は空気が薄いものとして下向きの力が働き、
   * ceilingY で完全に止まる
   */
  softCeilingY: 150,
  ceilingY: 46,
  /** 高いところで働く下向きの力の最大値 */
  ceilingPush: 900,
};

export const PLANE = {
  /** 表示幅（画面幅の 8%） */
  width: VIEW.width * 0.08,
  /** 当たり判定の半径 */
  hitRadius: VIEW.width * 0.026,
  /** 180度ロールにかける秒数。速すぎると一瞬で終わって手応えがない */
  rollDuration: 0.85,
  /** リスポーンまでの秒数 */
  respawnDelay: 2.4,
  maxHp: 100,
  /** 被弾で性能が落ちる下限。ここまで落ちても飛べなくはしない */
  damageFloor: { engine: 0.55, handling: 0.5 },
  /** 被弾1発あたりの性能低下 */
  damageStep: { engine: 0.09, handling: 0.10 },
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
  /**
   * スロットル段階ごとの推力（加速度）。
   * 段階は 0=巡航 / 1=全開 の 2 つだけで、全開はボタンを押している間のみ。
   * 3段階の切替式は操作が increases 割に効果が読みにくかったため、押している間だけに変えた
   */
  thrust: [96, 150],
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
  /**
   * 風見安定の効きの下限。
   * 速度に比例させると、ほぼ止まった機体では機首が全く戻らず、
   * 空中で立ち往生して「操縦不能になった」ように見えてしまう。
   * 落下しはじめれば必ず機首が下を向くよう、下限を設ける
   */
  minWeathervane: 0.3,
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

/** スロットルの表示名。段階を増減したらここも合わせる */
export const THROTTLE_NAMES = ['巡航', '全開'] as const;

/**
 * 音量。エンジン音は鳴りっぱなしなので、単発の効果音より小さく保つ
 */
export const AUDIO = {
  master: 0.9,
  /** エンジン音だけにかかる倍率 */
  engine: 0.45,
  music: 0.5,
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

/**
 * 煙。
 * 通常飛行では出さない。損傷したときだけ、どこをやられたかが色でわかるようにする:
 *   エンジン損傷 → 黒煙
 *   操作系（舵）損傷 → 白煙
 */
export const SMOKE = {
  /** 損傷が最大のときの発生間隔。軽傷ならこれを損傷度で割った間隔になる */
  damageInterval: 0.12,
  damageLife: [2.1, 2.9] as const,
  damageSize: [0.42, 0.62] as const,   // 機体幅に対する比
  /** 損傷度がこれ未満なら煙を出さない */
  damageThreshold: 0.06,
  damageAlpha: { engine: 0.9, handling: 0.7 },
};
