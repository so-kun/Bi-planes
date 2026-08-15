/**
 * オプション画面に並べる項目そのもの。
 *
 * 「何が並ぶか」と「どう描くか」を分けてある ―― 項目が増えるたびに
 * 画面の組み立て（`src/scenes/OptionsScene.ts`）が読みにくくなっていたため。
 * こちらは値の出し入れだけを持ち、位置も色も知らない。
 *
 * 選べる値は `src/settings.ts` の `CHOICES` から取る。**画面に並ぶ値と、
 * 保存を読むときに通す検査を同じ表にしておく**ための決まりごと。
 */

import { AI_LEVELS, ENGINE, PLANE } from '../config';
import { levelSpeed } from '../flight';
import { sfx } from '../audio';
import type { FilmPipeline } from '../fx/FilmPipeline';
import {
  CHOICES, PAD_ACTIONS, resetSettings, saveSettings, settings, type PadBinding,
} from '../settings';

/** どの画面か */
export type Page = 'menu' | 'game' | 'pad';

export const PAGE_TITLE: Record<Page, string> = {
  menu: 'オプション',
  game: 'ゲーム設定',
  pad: 'コントローラー設定',
};

/**
 * 一覧に並ぶもの。
 *
 * - `shared` … 全体で1つ。どちらが変えても同じところに効く
 * - `each` … 人ごとに持つ。1P・2P の2列で出す
 * - `pad` … 人ごとのボタン割り当て。決定してから押して決める
 * - `action` … 押すだけ
 */
export type Row =
  | { kind: 'shared'; label: string; note?: string; get: () => string; step: (d: -1 | 1) => void }
  | { kind: 'each'; label: string; note?: string; get: (side: number) => string;
      step: (side: number, d: -1 | 1) => void }
  | { kind: 'pad'; label: string; note?: string; action: keyof PadBinding }
  | { kind: 'action'; label: string; note?: string; run: () => void };

/** 画面側から借りるもの。項目は画面の作りを知らないので、必要な操作だけ受け取る */
export interface RowContext {
  /** 今この画面に掛かっているフィルム。強さをその場で効かせるのに要る */
  film: () => FilmPipeline | null;
  /** 別の画面へ */
  go: (page: Page) => void;
  /** 初期設定に戻したあと、表示を作り直す */
  afterReset: () => void;
  /** その人のパッドを試しに震わせる。選んだ強さがその場で手に伝わるように */
  buzz: (side: number) => void;
}

/** 振動の強さの呼び名。値は `CHOICES.rumble` と同じ並び */
const RUMBLE_NAMES = ['切', '弱', '標準', '強'];

const FILM_NAMES = ['切', '弱', '既定', '標準', '強'];

/** 今の値の次（前）を返す。表に無い値からでも、いちばん近いところから動かす */
function cycle(list: number[], now: number, d: -1 | 1): number {
  const near = list.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
  const i = list.indexOf(near);
  return list[(i + d + list.length) % list.length];
}

export function buildRows(page: Page, ctx: RowContext): Row[] {
  if (page === 'menu') return menuRows(ctx);
  if (page === 'game') return gameRows(ctx);
  return padRows(ctx);
}

function menuRows(ctx: RowContext): Row[] {
  return [
    { kind: 'action', label: 'ゲーム設定',
      note: '音・見た目・ルール・機体の性能',
      run: () => ctx.go('game') },
    { kind: 'action', label: 'コントローラー設定',
      note: '機首の向き・スティックの遊び・ボタンの割り当て（1P・2P それぞれ）',
      run: () => ctx.go('pad') },
    { kind: 'action', label: '初期設定に戻す',
      note: 'すべての項目を最初の状態へ',
      run: () => {
        resetSettings();
        sfx.applyVolume();
        sfx.applyBgmSetting();
        ctx.film()?.setLevel(settings.film);
        sfx.menuDecide();
        ctx.afterReset();
      } },
  ];
}

function gameRows(ctx: RowContext): Row[] {
  return [
    { kind: 'shared',
      label: '音量',
      get: () => `${Math.round(settings.volume * 100)}%`,
      step: (d) => {
        settings.volume = Math.min(1, Math.max(0, Math.round((settings.volume + d * 0.1) * 10) / 10));
        sfx.applyVolume();
        saveSettings();
      } },
    { kind: 'shared',
      label: 'BGM',
      get: () => (settings.bgm ? '入' : '切'),
      step: () => { settings.bgm = !settings.bgm; sfx.applyBgmSetting(); saveSettings(); } },
    { kind: 'shared',
      label: '古いフィルム風の効果',
      note: '粒とゆらぎの強さ。切ると絵がそのまま出る',
      get: () => FILM_NAMES[settings.film] ?? String(settings.film),
      step: (d) => {
        settings.film = cycle(CHOICES.film, settings.film, d);
        ctx.film()?.setLevel(settings.film);
        saveSettings();
      } },
    { kind: 'shared',
      label: 'コンピュータの強さ',
      note: 'ステージ選択の左右でも選べる。どちらで変えても同じところを見ている',
      get: () => AI_LEVELS[settings.aiLevel - 1]?.name ?? String(settings.aiLevel),
      step: (d) => { settings.aiLevel = cycle(CHOICES.aiLevel, settings.aiLevel, d); saveSettings(); } },
    { kind: 'shared',
      label: '勝ちに必要な点',
      get: () => `${settings.winning} 点`,
      step: (d) => { settings.winning = cycle(CHOICES.winning, settings.winning, d); saveSettings(); } },
    { kind: 'shared',
      label: '7.7mm の威力',
      note: '一発あたり。20mm は一撃撃墜のまま変わらない',
      get: () => `${settings.mgDamage}（${Math.ceil(PLANE.maxHp / settings.mgDamage)} 発で撃墜）`,
      step: (d) => { settings.mgDamage = cycle(CHOICES.mgDamage, settings.mgDamage, d); saveSettings(); } },
    { kind: 'shared',
      label: '全開のパワー',
      note: '押している間の推力。巡航（速度 288）は変わらない',
      // 速度は表に書き写さず、飛びの計算そのものから出す（`levelSpeed`）。
      // 書き写すと、飛びの数値をいじったときに表示だけが古いまま残る
      get: () => `${settings.thrust}（速度 ${levelSpeed(settings.thrust)}）`,
      step: (d) => { settings.thrust = cycle(CHOICES.thrust, settings.thrust, d); saveSettings(); } },
    { kind: 'shared',
      label: '全開で水温が上がる速さ',
      note: '「上がらない」にすると過熱しなくなる。冷える速さは変わらない',
      // 数字だけでは手応えに結び付かないので、冷えきりから振り切れまでの秒数で見せる
      get: () => (settings.tempRise <= 0
        ? '上がらない'
        : `振り切れまで ${((1 - ENGINE.tempFloor) / settings.tempRise).toFixed(1)} 秒`),
      step: (d) => { settings.tempRise = cycle(CHOICES.tempRise, settings.tempRise, d); saveSettings(); } },
    { kind: 'action', label: '戻る', run: () => ctx.go('menu') },
  ];
}

function padRows(ctx: RowContext): Row[] {
  return [
    { kind: 'each',
      label: '機首の向き',
      note: '「引くと上げ」は操縦桿と同じ向き。その人のキーとパッドの両方に効く',
      get: (side) => (settings.pullToClimb[side] ? '引くと上げ' : '倒すと上げ'),
      step: (side) => { settings.pullToClimb[side] = !settings.pullToClimb[side]; saveSettings(); } },
    { kind: 'each',
      label: 'スティックの遊び',
      note: '中央の、倒していないとみなす幅。大きいほど手が休まる',
      get: (side) => settings.deadzones[side].toFixed(2),
      step: (side, d) => {
        settings.deadzones[side] = cycle(CHOICES.deadzone, settings.deadzones[side], d);
        saveSettings();
      } },
    { kind: 'each',
      label: '振動の強さ',
      note: '被弾・過熱・撃墜で震えます。選ぶとその場で試しに震えます'
        + '（Safari など対応していないブラウザでは何も起きません）',
      get: (side) => RUMBLE_NAMES[CHOICES.rumble.indexOf(settings.rumble[side])] ?? String(settings.rumble[side]),
      step: (side, d) => {
        settings.rumble[side] = cycle(CHOICES.rumble, settings.rumble[side], d);
        saveSettings();
        ctx.buzz(side);
      } },
    ...PAD_ACTIONS.map((a): Row => ({
      kind: 'pad',
      label: `　　${a.label}`,
      note: '割り当てたいボタンを、そのまま押してください'
        + '（十字キーの上下とスティックは項目を選ぶのに使います）',
      action: a.key,
    })),
    { kind: 'action', label: '戻る', run: () => ctx.go('menu') },
  ];
}
