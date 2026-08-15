/**
 * オプション画面。ステージ選択から入る。
 *
 * **3枚ある**（`init` の `page`）――
 * 入口の「選ぶだけ」の画面と、**ゲーム設定**、**コントローラー設定**。
 * 項目が増えて一画面に収まらなくなったので分けた。中の仕掛けは3枚とも同じで、
 * 並べる項目だけが違う。
 *
 * **1P と 2P が同時に操作できる。** カーソルは2本あり、それぞれのパッドが
 * 自分のカーソルを動かす。パッドの割り当てのように人ごとに持つ項目は
 * 1P・2P の2列で並べ、**自分の列だけ**を書き換える。
 * 音量やルールのように全体で1つの項目は、どちらが変えても同じところに効く。
 *
 * キーボードは既定で 1P の列を担当し、**Tab で 2P の列に移せる**。
 * パッドが1台しかなくても 2P 側を組めるようにするため。
 *
 * 変えたそばから効く（音量もフィルムもその場で変わる）ようにして、
 * 「決定」を押さないと反映されない作りは避けた。設定はそのつど保存する。
 */

import Phaser from 'phaser';
import { ENGINE, PLANE, VIEW } from '../config';
import { sfx } from '../audio';
import { attachFilm } from '../fx/attachFilm';
import type { FilmPipeline } from '../fx/FilmPipeline';
import { PadInput, PAD_IDLE } from '../input/PadInput';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import {
  PAD_ACTIONS, PLAYER_NAMES, buttonName, resetSettings, saveSettings, settings, type PadBinding,
} from '../settings';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const CREAM = '#f4e6c8';
const INK = '#241a12';
const GOLD = '#ffd76b';
/** 1P・2P の色。機体と計器盤に合わせてある */
const SIDE_COLOR = ['#e8836a', '#8fb6d8'];

/**
 * 一覧に並ぶもの。
 *
 * - `shared` … 全体で1つ。どちらが変えても同じところに効く
 * - `each` … 人ごとに持つ。1P・2P の2列で出す
 * - `pad` … 人ごとのボタン割り当て。決定してから押して決める
 * - `action` … 押すだけ
 */
type Row =
  | { kind: 'shared'; label: string; note?: string; get: () => string; step: (d: -1 | 1) => void }
  | { kind: 'each'; label: string; note?: string; get: (side: number) => string;
      step: (side: number, d: -1 | 1) => void }
  | { kind: 'pad'; label: string; note?: string; action: keyof PadBinding }
  | { kind: 'action'; label: string; note?: string; run: () => void };

/** 選べる値。左右で前後に動かす */
const DEADZONES = [0.10, 0.15, 0.22, 0.30, 0.40];
const FILM_NAMES = ['切', '弱', '既定', '標準', '強'];
const WINNING = [10, 15, 20, 30, 50];
/**
 * 7.7mm 一発の威力。整数だけを並べてある ―― HP に端数が出ると、
 * 計器の目盛りも「あと何発」も読みにくくなる。既定は 15（7発で撃墜）
 */
const MG_DAMAGE = [5, 10, 15, 20, 25, 50];
/**
 * 全開の推力と、そのときに落ち着く速度（`node tools/flight-probe.mjs` で実測）。
 * 巡航は 96（速度 288）で据え置き ―― 巡航まで速くすると、全開が「ここぞという時の手」でなくなる
 */
const THRUST = [
  { power: 150, speed: 371 },
  { power: 180, speed: 409 },
  { power: 220, speed: 454 },
  { power: 260, speed: 495 },
  { power: 300, speed: 532 },
];
/**
 * 全開のときに水温が上がる速さ（毎秒）。
 * 冷えきり（0.30）から振り切れ（1.0）までの秒数で見せる ―― 数字だけでは手応えに結び付かない。
 * 0 は「上がらない」＝過熱そのものが起きない
 */
const TEMP_RISE = [0, 0.07, 0.10, 0.14, 0.20, 0.28];

/** ボタンの割り当て待ちを打ち切るまでの秒数 */
const WAIT_LIMIT = 8;

/** 一覧の見た目 */
const TOP = 116;
const STEP = 28;
const LABEL_X = 244;
/** 全体で1つの項目と、人ごとの項目のあいだに空ける高さ（区切り線と見出しが入る） */
const GAP = 30;
/** 人ごとの項目の値を出す位置。全体で1つの項目は左の列だけ使う */
const COL_X = [690, 940];

/** どの画面か */
type Page = 'menu' | 'game' | 'pad';

const PAGE_TITLE: Record<Page, string> = {
  menu: 'オプション',
  game: 'ゲーム設定',
  pad: 'コントローラー設定',
};

export class OptionsScene extends Phaser.Scene {
  private page: Page = 'menu';
  private rows: Row[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  /** 値の表示。`[行][列]`。全体で1つの項目は列 0 だけ使う */
  private values: Phaser.GameObjects.Text[][] = [];
  private cursors: Phaser.GameObjects.Text[] = [];
  private hint!: Phaser.GameObjects.Text;
  private kbNote!: Phaser.GameObjects.Text;
  private film: FilmPipeline | null = null;

  /** 1P・2P のパッド。それぞれ自分のカーソルを動かす */
  private pads = [new PadInput(0), new PadInput(1)];
  /**
   * このフレームで読んだパッドの状態。
   * `read()` は「押した瞬間」を数えるので**1フレームに一度しか呼べない** ――
   * 表示の組み立てから呼ぶと、そのぶん立ち上がりを食べてしまう
   */
  private padStates = [PAD_IDLE, PAD_IDLE];
  private padMenus = [new PadMenu(), new PadMenu()];
  private padUpHeld = [false, false];
  private keyGuard!: StuckKeyGuard;

  /** それぞれのカーソルがどの行にいるか */
  private index = [0, 0];
  /** キーボードがどちらの列を担当しているか。Tab で入れ替える */
  private kbSide = 0;

  /**
   * ボタンの割り当て待ち。null なら待っていない。人ごとに持つ。
   * 待っている間、その人はほかの操作を受け付けない ――
   * 割り当てたいボタンが「決定」や「取り消し」と重なることがあるため
   */
  private waiting: (keyof PadBinding | null)[] = [null, null];
  /** 待ちに入ったあと、いったん全部離すまで拾わない */
  private waitArmed = [false, false];
  /** 待ちはじめてからの秒数。押されないまま置き去りにならないよう打ち切る */
  private waitTimer = [0, 0];

  constructor() {
    super('Options');
  }

  init(data: { page?: Page }): void {
    this.page = data?.page ?? 'menu';
  }

  create(): void {
    // 画面は作り直されても構築子は呼ばれない。**作った物の控えは必ずここで空にする** ――
    // 空にし忘れると、開くたびに古い（もう消えた）文字が前に積み上がり、
    // 2回目以降はカーソルも値も動かなくなる
    this.rows = [];
    this.labels = [];
    this.values = [];
    this.cursors = [];
    this.index = [0, 0];
    this.kbSide = 0;
    this.waiting = [null, null];
    this.waitArmed = [false, false];
    this.waitTimer = [0, 0];
    this.padUpHeld = [false, false];
    this.padStates = this.pads.map((p) => p.read());
    for (const m of this.padMenus) m.disarm();

    const bg = this.add.image(0, 0, 'title-bg').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x10233a, 0.55).setOrigin(0);

    this.add.text(VIEW.width / 2, 62, PAGE_TITLE[this.page], {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '38px', color: CREAM,
      stroke: INK, strokeThickness: 7,
    }).setOrigin(0.5);

    this.buildRows();
    this.layout();
    this.setupInput();
    this.film = attachFilm(this);
    this.refresh();
  }

  // ---------------------------------------------------------------- 項目

  private buildRows(): void {
    const cycle = <T>(list: T[], now: T, d: -1 | 1): T => {
      const i = list.indexOf(now);
      return list[((i < 0 ? 0 : i) + d + list.length) % list.length];
    };
    const nearest = (list: number[], now: number): number =>
      list.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));

    if (this.page === 'menu') {
      this.rows = [
        { kind: 'action', label: 'ゲーム設定',
          note: '音・見た目・ルール・機体の性能',
          run: () => this.go('game') },
        { kind: 'action', label: 'コントローラー設定',
          note: '機首の向き・スティックの遊び・ボタンの割り当て（1P・2P それぞれ）',
          run: () => this.go('pad') },
        { kind: 'action', label: '初期設定に戻す',
          note: 'すべての項目を最初の状態へ',
          run: () => this.resetAll() },
      ];
      return;
    }

    if (this.page === 'game') {
      this.rows = [
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
            settings.film = (settings.film + d + FILM_NAMES.length) % FILM_NAMES.length;
            this.film?.setLevel(settings.film);
            saveSettings();
          } },
        { kind: 'shared',
          label: '勝ちに必要な点',
          get: () => `${settings.winning} 点`,
          step: (d) => { settings.winning = cycle(WINNING, settings.winning, d); saveSettings(); } },
        { kind: 'shared',
          label: '7.7mm の威力',
          note: '一発あたり。20mm は一撃撃墜のまま変わらない',
          get: () => `${settings.mgDamage}（${Math.ceil(PLANE.maxHp / settings.mgDamage)} 発で撃墜）`,
          step: (d) => { settings.mgDamage = cycle(MG_DAMAGE, settings.mgDamage, d); saveSettings(); } },
        { kind: 'shared',
          label: '全開のパワー',
          note: '押している間の推力。巡航（速度 288）は変わらない',
          get: () => {
            const now = THRUST.find((t) => t.power === settings.thrust);
            return now ? `${now.power}（速度 ${now.speed}）` : String(settings.thrust);
          },
          step: (d) => {
            const now = nearest(THRUST.map((t) => t.power), settings.thrust);
            settings.thrust = cycle(THRUST.map((t) => t.power), now, d);
            saveSettings();
          } },
        { kind: 'shared',
          label: '全開で水温が上がる速さ',
          note: '「上がらない」にすると過熱しなくなる。冷える速さは変わらない',
          get: () => (settings.tempRise <= 0
            ? '上がらない'
            : `振り切れまで ${((1 - ENGINE.tempFloor) / settings.tempRise).toFixed(1)} 秒`),
          step: (d) => {
            settings.tempRise = cycle(TEMP_RISE, nearest(TEMP_RISE, settings.tempRise), d);
            saveSettings();
          } },
        { kind: 'action', label: '戻る', run: () => this.go('menu') },
      ];
      return;
    }

    this.rows = [
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
          settings.deadzones[side] = cycle(DEADZONES, nearest(DEADZONES, settings.deadzones[side]), d);
          saveSettings();
        } },
      ...PAD_ACTIONS.map((a): Row => ({
        kind: 'pad',
        label: `　　${a.label}`,
        note: '決定（Enter・○A）を押してから、割り当てたいボタンを押す',
        action: a.key,
      })),
      { kind: 'action', label: '戻る', run: () => this.go('menu') },
    ];
  }

  /** 別の画面へ。画面ごとに作り直すので、控えは create で空にしている */
  private go(page: Page): void {
    sfx.menuDecide();
    this.scene.start('Options', { page });
  }

  private resetAll(): void {
    resetSettings();
    sfx.applyVolume();
    sfx.applyBgmSetting();
    this.film?.setLevel(settings.film);
    sfx.menuDecide();
    this.refresh();
  }

  /** 人ごとの項目が始まる行。ここに区切り線と 1P / 2P の見出しを置く */
  private get eachFrom(): number {
    return this.rows.findIndex((r) => r.kind === 'each' || r.kind === 'pad');
  }

  /** その行の高さ。人ごとの項目は、見出しを入れるぶんだけ下へずらす */
  private rowY(i: number): number {
    // 入口の画面は数が少ないので、真ん中あたりにゆったり置く
    const top = this.page === 'menu' ? 250 : TOP;
    const step = this.page === 'menu' ? 56 : STEP;
    const gap = this.eachFrom >= 0 && i >= this.eachFrom ? GAP : 0;
    return top + i * step + gap;
  }

  private layout(): void {
    // 1P・2P の2列があるのはコントローラー設定だけ。区切りと見出しもそこにだけ出す
    if (this.eachFrom >= 0) {
      const divY = this.rowY(this.eachFrom) - STEP * 0.8;
      this.add.rectangle(VIEW.width / 2, divY, 900, 1, 0xf4e6c8, 0.35);
      this.add.text(LABEL_X, divY - 12, 'ここから下は 1P・2P それぞれ', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: CREAM,
      }).setOrigin(0, 0.5).setAlpha(0.75);
      PLAYER_NAMES.forEach((name, side) => {
        this.add.text(COL_X[side], divY - 12, name, {
          fontFamily: 'Georgia, serif', fontSize: '17px', color: SIDE_COLOR[side],
          stroke: INK, strokeThickness: 4,
        }).setOrigin(0, 0.5);
      });
    }

    this.rows.forEach((r, i) => {
      const y = this.rowY(i);
      this.labels.push(this.add.text(LABEL_X, y, r.label, {
        fontFamily: 'Georgia, serif', fontSize: this.page === 'menu' ? '27px' : '19px', color: CREAM,
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0, 0.5));
      // 全体で1つの項目は左の列だけ、人ごとの項目は2列
      const cols = r.kind === 'each' || r.kind === 'pad' ? 2 : r.kind === 'action' ? 0 : 1;
      this.values.push(Array.from({ length: cols }, (_, c) => this.add.text(COL_X[c], y, '', {
        fontFamily: 'Georgia, serif', fontSize: '19px', color: CREAM,
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0, 0.5)));
    });

    // カーソルは2本。1P は左から、2P は右から差す
    this.cursors = [
      this.add.text(LABEL_X - 26, this.rowY(0), '▶', {
        fontFamily: 'Georgia, serif', fontSize: '18px', color: SIDE_COLOR[0],
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0.5),
      this.add.text(VIEW.width - 158, this.rowY(0), '◀', {
        fontFamily: 'Georgia, serif', fontSize: '18px', color: SIDE_COLOR[1],
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0.5),
    ];

    this.hint = this.add.text(VIEW.width / 2, VIEW.height - 96, '', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: GOLD,
      backgroundColor: 'rgba(24,16,10,0.62)', padding: { x: 14, y: 5 },
    }).setOrigin(0.5);

    this.add.text(VIEW.width / 2, VIEW.height - 54,
      '↑ ↓ 項目　　← → 変更　　Enter 決定　　Esc 戻る　　'
      + 'パッドはスティック上下と L / R、決定 ○A・戻る ×B', {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.55)', padding: { x: 14, y: 5 },
      }).setOrigin(0.5);

    this.kbNote = this.add.text(VIEW.width / 2, VIEW.height - 20, '', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: CREAM,
      backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setAlpha(0.8);
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      const on = this.index.some((n, side) => n === i && this.active(side));
      this.labels[i].setColor(on ? GOLD : CREAM);
      this.labels[i].setAlpha(on ? 1 : 0.72);

      this.values[i].forEach((t, c) => {
        const mine = this.index[c] === i && this.active(c);
        const each = r.kind === 'each' || r.kind === 'pad';
        if (r.kind === 'pad') {
          t.setText(this.waiting[c] === r.action
            ? '― 押してください ―'
            : buttonName(settings.pads[c][r.action]));
        } else if (r.kind === 'each') {
          t.setText(`◂ ${r.get(c)} ▸`);
        } else if (r.kind === 'shared') {
          t.setText(`◂ ${r.get()} ▸`);
        }
        // 人ごとの列は、その人が見ているときだけ金色。ふだんは持ち主の色
        t.setColor(mine ? GOLD : each ? SIDE_COLOR[c] : CREAM);
        t.setAlpha(mine ? 1 : 0.75);
      });
    });

    this.cursors.forEach((c, side) => {
      c.setY(this.rowY(this.index[side]));
      c.setVisible(this.active(side));
    });

    this.kbNote.setText(this.page === 'pad'
      ? `Tab　キーボードで直す側 … いまは ${PLAYER_NAMES[this.kbSide]}　　`
        + '（パッドはそれぞれ自分の列を直します）'
      : '1P・2P のどちらのパッドでも操作できます');

    // 説明はキーボードが見ている行のもの。二人ぶん出すと下が埋まる
    const here = this.rows[this.index[this.kbSide]];
    let hint = '';
    if (this.waiting[0] || this.waiting[1]) hint = '割り当てたいボタンを押してください（Esc でやめる）';
    else if (here?.note) hint = here.note;
    this.hint.setText(hint);
    this.hint.setVisible(hint !== '');
  }

  /**
   * その列を今だれかが操作しているか。
   * 2P はパッドがつながっているか、キーボードが 2P 側に移っているときだけ動かせる ――
   * 誰も触れない列にカーソルを出しても紛らわしいだけなので隠す
   */
  private active(side: number): boolean {
    return this.kbSide === side || this.padStates[side].connected;
  }

  // ---------------------------------------------------------------- 入力

  private setupInput(): void {
    const kb = this.input.keyboard!;
    const keys = kb.addKeys({
      up: KEY.UP, down: KEY.DOWN, left: KEY.LEFT, right: KEY.RIGHT,
      w: KEY.W, s: KEY.S, a: KEY.A, d: KEY.D,
      enter: KEY.ENTER, space: KEY.SPACE, back: KEY.ESC, swap: KEY.TAB,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    this.keyGuard = new StuckKeyGuard(keys);
    this.keyGuard.attach();

    const wake = (): void => { sfx.resume(); sfx.playBgm('menu'); };
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    for (const k of ['up', 'w']) keys[k].on('down', () => this.move(this.kbSide, -1));
    for (const k of ['down', 's']) keys[k].on('down', () => this.move(this.kbSide, 1));
    for (const k of ['left', 'a']) keys[k].on('down', () => this.change(this.kbSide, -1));
    for (const k of ['right', 'd']) keys[k].on('down', () => this.change(this.kbSide, 1));
    for (const k of ['enter', 'space']) keys[k].on('down', () => this.decide(this.kbSide));
    keys.back.on('down', () => this.back(this.kbSide));
    keys.swap.on('down', () => this.swapKeyboardSide());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyGuard.detach();
      kb.removeAllKeys(true);
    });
  }

  /** キーボードが直す列を入れ替える。パッド1台でも 2P 側を組めるようにするため */
  private swapKeyboardSide(): void {
    if (this.waiting[this.kbSide]) return;
    this.kbSide = (this.kbSide + 1) % PLAYER_NAMES.length;
    sfx.menuLevel(1);
    this.refresh();
  }

  private move(side: number, d: -1 | 1): void {
    if (this.waiting[side]) return;
    this.index[side] = (this.index[side] + d + this.rows.length) % this.rows.length;
    sfx.menuMove();
    this.refresh();
  }

  private change(side: number, d: -1 | 1): void {
    if (this.waiting[side]) return;
    const r = this.rows[this.index[side]];
    if (!r) return;
    if (r.kind === 'shared') r.step(d);
    else if (r.kind === 'each') r.step(side, d);
    else return;
    sfx.menuLevel(d);
    this.refresh();
  }

  private decide(side: number): void {
    if (this.waiting[side]) return;
    const r = this.rows[this.index[side]];
    if (!r) return;
    if (r.kind === 'pad') {
      this.waiting[side] = r.action;
      this.waitArmed[side] = false;
      this.waitTimer[side] = 0;
      sfx.menuDecide();
      this.refresh();
      return;
    }
    if (r.kind === 'action') { r.run(); return; }
    // 値の項目は決定でも一段進める。左右に気づかなくても変えられるように
    this.change(side, 1);
  }

  private back(side: number): void {
    if (this.waiting[side]) {
      this.waiting[side] = null;
      sfx.menuBack();
      this.refresh();
      return;
    }
    saveSettings();
    sfx.menuBack();
    // 下の画面からは入口へ、入口からはステージ選択へ戻る
    if (this.page !== 'menu') this.scene.start('Options', { page: 'menu' });
    else this.scene.start('Title');
  }

  /**
   * 割り当て待ちの読み取り。
   *
   * 押されたボタンをそのまま割り当てる。**同じボタンが別の操作に付いていたら入れ替える** ――
   * 消さずに残すと、二つの操作が同時に出て収拾がつかなくなる。
   * 入れ替えるのはその人のパッドの中だけで、もう一方には触らない。
   * 決定に使ったボタンをそのまま拾わないよう、一度すべて離すまで待つ
   */
  private captureButton(side: number, dt: number): void {
    const held = this.pressedButtons(side);
    if (!this.waitArmed[side]) {
      if (held.length === 0) this.waitArmed[side] = true;
      return;
    }
    this.waitTimer[side] += dt;
    if (held.length === 0) {
      // パッドだけで遊んでいて押せるボタンが無くなった場合の逃げ道
      if (this.waitTimer[side] > WAIT_LIMIT) {
        this.waiting[side] = null;
        sfx.menuBack();
        this.refresh();
      }
      return;
    }

    const button = held[0];
    const action = this.waiting[side]!;
    const bind = settings.pads[side];
    const before = bind[action];
    for (const { key } of PAD_ACTIONS) {
      if (key !== action && bind[key] === button) bind[key] = before;
    }
    bind[action] = button;
    saveSettings();
    this.waiting[side] = null;
    sfx.menuDecide();
    this.refresh();
  }

  /**
   * いま押されているボタンの番号。
   *
   * **その列のパッドを見る**。つながっていなければ、キーボードがその列を
   * 担当しているときにかぎり1台目で代用する（パッド1台でも 2P 側を組めるように）
   */
  private pressedButtons(side: number): number[] {
    const out: number[] = [];
    try {
      if (!navigator.getGamepads) return out;
      const pads = [...navigator.getGamepads()]
        .filter((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
      const pad = pads[side] ?? (this.kbSide === side ? pads[0] : undefined);
      if (!pad) return out;
      pad.buttons.forEach((b, i) => { if (b.pressed) out.push(i); });
    } catch {
      return out;                    // 読めない環境。割り当ては変えられないだけ
    }
    return out;
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.keyGuard.update();

    // パッドはこのフレームで一度だけ読む（立ち上がりを食べないように）
    this.padStates = this.pads.map((p) => p.read());

    for (let side = 0; side < this.pads.length; side++) {
      if (this.waiting[side]) {
        this.captureButton(side, dt);
        continue;                    // 待っている人はほかの操作を読まない
      }
      const s = this.padStates[side];
      if (!s.connected) continue;
      if (Math.abs(s.pitch) > 0.5) {
        if (!this.padUpHeld[side]) {
          this.padUpHeld[side] = true;
          this.move(side, s.pitch > 0 ? -1 : 1);   // スティックを上に倒すと pitch は正
        }
      } else {
        this.padUpHeld[side] = false;
      }
      if (s.rollEdge !== 0) this.change(side, s.rollEdge);

      const m = this.padMenus[side].read(s);
      if (m.decide) this.decide(side);
      else if (m.cancel) this.back(side);
    }
  }
}
