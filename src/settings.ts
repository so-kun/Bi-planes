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

import { AUDIO, FILM_DEFAULT, PAD, SCORE } from './config';

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
  /** 機首の向き。true = 引く（下）と機首が上がる（既定） */
  pullToClimb: boolean;
  /** 全体の音量（0〜1） */
  volume: number;
  bgm: boolean;
  /** フィルムの強さ（0〜4） */
  film: number;
  /** 何点先取で勝ちか */
  winning: number;
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

export const DEFAULTS: Settings = {
  pads: [{ ...DEFAULT_BINDING }, { ...DEFAULT_BINDING }],
  deadzones: [PAD.deadzone, PAD.deadzone],
  pullToClimb: true,
  volume: AUDIO.master,
  bgm: true,
  film: FILM_DEFAULT,
  winning: SCORE.winning,
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
    if (typeof z === 'number' && z >= 0 && z < 0.9) settings.deadzones[i] = z;
  });
  if (typeof s.pullToClimb === 'boolean') settings.pullToClimb = s.pullToClimb;
  if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1) settings.volume = s.volume;
  if (typeof s.bgm === 'boolean') settings.bgm = s.bgm;
  if (typeof s.film === 'number' && Number.isInteger(s.film) && s.film >= 0 && s.film <= 4) settings.film = s.film;
  if (typeof s.winning === 'number' && Number.isInteger(s.winning) && s.winning > 0) settings.winning = s.winning;
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
