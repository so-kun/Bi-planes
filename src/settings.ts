/**
 * 遊ぶ人ごとの設定。オプション画面（`src/scenes/OptionsScene.ts`）で変えて、
 * ブラウザに保存する。
 *
 * 触るのは**一つの生きたオブジェクト**（`settings`）だけにしてある。
 * 画面をまたいで読むものなので、写しを配ると「どちらが本物か」が分からなくなる。
 * 変えたら `saveSettings()` を呼ぶ。
 *
 * 保存に失敗しても（プライベートモードなど）ゲームは続ける ――
 * その回だけ設定が残らないだけで、遊べなくなる理由にはならない。
 */

import { AI_LEVELS, AUDIO, ENGINE, FILM_PRESETS, FILM_DEFAULT, FLIGHT, PAD, SCORE, WEAPON } from './config';

const STORE_KEY = 'biplanes.settings';

/** パッドのボタン割り当て。値は標準配列のボタン番号 */
export interface PadBinding {
  mg: number;
  cannon: number;
  rollL: number;
  rollR: number;
  throttle: number;
  /** メニューでの決定。既定は 20mm と同じ ○／A */
  decide: number;
  /** メニューでの取り消し。既定は 7.7mm と同じ ×／B */
  cancel: number;
  /** 飛行中に中断してタイトルへ */
  start: number;
  /** プラクティスのやり直し */
  select: number;
}

export interface Settings {
  /**
   * パッドの割り当て。**1P と 2P で別々**に持つ。
   * 手元にある2台のパッドが同じ機種とは限らないので、片方だけ組み替えられるようにしてある
   */
  pads: [PadBinding, PadBinding];
  /** スティック中央の遊び。これもパッドごと */
  deadzones: [number, number];
  /**
   * 機首の向き。true = 引く（下）と機首が上がる（既定）。
   * **1P と 2P で別々**に持つ ―― その人のキーボードとパッドの両方に効く
   */
  pullToClimb: [boolean, boolean];
  /** 全体の音量（0〜1） */
  volume: number;
  bgm: boolean;
  /** フィルムの強さ（0〜4） */
  film: number;
  /** 何点先取で勝ちか */
  winning: number;
  /**
   * 7.7mm 一発の威力。HP は 100 なので、撃墜までの発数は 100 ÷ これ。
   * 20mm（一撃撃墜）は変えない ―― 一撃という位置づけそのものが崩れるため
   */
  mgDamage: number;
  /**
   * 全開のときの推力。巡航（96）は変えない ―― 巡航まで速くすると、
   * 全開が「ここぞという時の手」でなくなる
   */
  thrust: number;
  /**
   * 全開のときに水温が上がる速さ（毎秒）。0 なら上がらない＝過熱しない。
   * 冷える速さ（`ENGINE.tempFall`）は変えない
   */
  tempRise: number;
  /**
   * コンピュータの腕前。1 = 弱 / 2 = 普通 / 3 = 強。
   * ステージ選択の左右でも選べる ―― どちらで変えても同じところを見る
   */
  aiLevel: number;
}

const DEFAULT_BINDING: PadBinding = {
  mg: PAD.buttons.mg,
  cannon: PAD.buttons.cannon,
  rollL: PAD.buttons.rollL,
  rollR: PAD.buttons.rollR,
  throttle: PAD.buttons.throttle,
  decide: PAD.buttons.cannon,
  cancel: PAD.buttons.mg,
  start: PAD.buttons.start,
  select: PAD.buttons.select,
};

/**
 * 最初の状態。数値は `src/config.ts` から取る ―― 遊びの数値の出どころは1か所にする。
 * **数値の項目は、下の `CHOICES` に並んでいる値であること**（保存を読むときに
 * その表へ寄せるので、外れていると既定のまま遊べない値ができてしまう）
 */
export const DEFAULTS: Settings = {
  pads: [{ ...DEFAULT_BINDING }, { ...DEFAULT_BINDING }],
  deadzones: [PAD.deadzone, PAD.deadzone],
  pullToClimb: [true, true],
  volume: AUDIO.master,
  bgm: true,
  film: FILM_DEFAULT,
  winning: SCORE.winning,
  mgDamage: WEAPON.mg.damage,
  thrust: FLIGHT.thrust[1],
  tempRise: ENGINE.tempRise,
  aiLevel: 2,
};

/**
 * 選べる値。**オプション画面が並べるのも、保存を読むときに検査するのもこの表**。
 *
 * 別々に持っていたころは、画面に無い値が保存に入っていても素通りしていた ――
 * `aiLevel: 4`（段階は3つしかない）や `mgDamage: 12.5`（HP に端数が出る）が
 * そのまま効いてしまう。ひとつの表にしておけば、その食い違いは起こらない。
 *
 * 段階の数を config 側から取っている項目（フィルム・コンピュータの強さ）は、
 * 中身を増やせばここも自動でついてくる
 */
export const CHOICES = {
  /** スティック中央の遊び */
  deadzone: [0.10, 0.15, 0.22, 0.30, 0.40],
  /** フィルムの強さ。切〜強 */
  film: FILM_PRESETS.map((_, i) => i),
  /** 何点先取で勝ちか */
  winning: [10, 15, 20, 30, 50],
  /**
   * 7.7mm 一発の威力。整数だけを並べてある ―― HP に端数が出ると、
   * 計器の目盛りも「あと何発」も読みにくくなる
   */
  mgDamage: [5, 10, 15, 20, 25, 50],
  /** 全開のときの推力。落ち着く速度は飛びの計算から出す（`levelSpeed`） */
  thrust: [150, 180, 220, 260, 300],
  /** 全開のときに水温が上がる速さ（毎秒）。0 は「上がらない」＝過熱しない */
  tempRise: [0, 0.07, 0.10, 0.14, 0.20, 0.28],
  /** コンピュータの強さ。0 は「人が操縦」なので設定には入れない */
  aiLevel: AI_LEVELS.map((_, i) => i + 1),
};

/** 今の設定。ここを直接読み書きする */
export const settings: Settings = structuredClone(DEFAULTS);

/** 割り当てられる操作の名前。オプション画面の並び順でもある */
export const PAD_ACTIONS: { key: keyof PadBinding; label: string }[] = [
  { key: 'mg', label: '7.7mm 機銃' },
  { key: 'cannon', label: '20mm 機関砲' },
  { key: 'rollL', label: 'ロール左' },
  { key: 'rollR', label: 'ロール右' },
  { key: 'throttle', label: '全開' },
  { key: 'decide', label: '決定' },
  { key: 'cancel', label: '取り消し' },
  { key: 'start', label: '中断（タイトルへ）' },
  { key: 'select', label: 'やり直し' },
];

/**
 * 標準配列のボタン番号に付いている名前。
 * 機種ごとに刻印が違うので、二つ並べて書く（PlayStation ／ Xbox・Switch）
 */
const BUTTON_NAMES: Record<number, string> = {
  0: '× ／ B', 1: '○ ／ A', 2: '□ ／ X', 3: '△ ／ Y',
  4: 'L1 ／ L', 5: 'R1 ／ R', 6: 'L2 ／ ZL', 7: 'R2 ／ ZR',
  8: 'Select ／ −', 9: 'Start ／ ＋',
  10: '左スティック押し', 11: '右スティック押し',
  12: '十字↑', 13: '十字↓', 14: '十字←', 15: '十字→',
  16: 'ホーム',
};

export function buttonName(index: number): string {
  return BUTTON_NAMES[index] ?? `ボタン ${index}`;
}

/** 並んでいる値のうち、いちばん近いものへ寄せる */
function nearest(list: number[], value: number): number {
  return list.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
}

/**
 * 保存された数値を取り込む。
 * **選べる値の表にあるものへ寄せる** ―― 画面に出しようのない値が
 * 保存に入っていても、そのまま効いてしまわないようにする
 */
function pick(list: number[], value: unknown, now: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? nearest(list, value) : now;
}

/**
 * 読み込む。壊れた値が入っていても既定で埋めて動かす ――
 * 前の版の保存が残っていたり、手で書き換えられていたりしても、
 * ゲームが立ち上がらないほうが困る
 */
export function loadSettings(): void {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    return;                       // 読めない環境。既定のまま進む
  }
  if (!raw) return;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof saved !== 'object' || saved === null) return;
  const s = saved as Partial<Settings>;

  // 1P・2P で分ける前の保存（pad / deadzone がひとつだけ）は、両方に配る
  const old = saved as { pad?: unknown; deadzone?: unknown };
  const bindings: unknown[] = Array.isArray(s.pads) ? s.pads : [old.pad, old.pad];
  bindings.forEach((b, i) => {
    if (i > 1 || !b || typeof b !== 'object') return;
    for (const { key } of PAD_ACTIONS) {
      const v = (b as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 16) settings.pads[i][key] = v;
    }
  });
  const zones: unknown[] = Array.isArray(s.deadzones) ? s.deadzones : [old.deadzone, old.deadzone];
  zones.forEach((z, i) => {
    if (i > 1) return;
    settings.deadzones[i] = pick(CHOICES.deadzone, z, settings.deadzones[i]);
  });
  // 1P・2P で分ける前の保存は真偽値ひとつだったので、そのときは両方に配る
  const climb: unknown = s.pullToClimb;
  if (typeof climb === 'boolean') settings.pullToClimb = [climb, climb];
  else if (Array.isArray(climb)) {
    climb.forEach((v, i) => { if (i <= 1 && typeof v === 'boolean') settings.pullToClimb[i] = v; });
  }
  // 音量だけは連なった値なので、表に寄せずに範囲で見る（0.1 刻みに丸める）
  if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) {
    settings.volume = Math.round(s.volume * 10) / 10;
  }
  if (typeof s.bgm === 'boolean') settings.bgm = s.bgm;
  settings.film = pick(CHOICES.film, s.film, settings.film);
  settings.winning = pick(CHOICES.winning, s.winning, settings.winning);
  settings.mgDamage = pick(CHOICES.mgDamage, s.mgDamage, settings.mgDamage);
  settings.thrust = pick(CHOICES.thrust, s.thrust, settings.thrust);
  settings.tempRise = pick(CHOICES.tempRise, s.tempRise, settings.tempRise);
  settings.aiLevel = pick(CHOICES.aiLevel, s.aiLevel, settings.aiLevel);
}

export function saveSettings(): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できない環境。その回だけ残らないだけなので、黙って続ける
  }
}

export function resetSettings(): void {
  Object.assign(settings, structuredClone(DEFAULTS));
  saveSettings();
}

/** 遊ぶ人の名前。オプション画面と、どちらのパッドを直すかの表示に使う */
export const PLAYER_NAMES = ['1P', '2P'];
