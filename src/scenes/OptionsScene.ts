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
 *
 * **ボタンの割り当ては、押したボタンがそのまま入る**（2026-08-15 改定）。
 * 「決定してから押す」の二段構えをやめた ―― 割り当てたいボタンを押すのが
 * いちばん短い言い方で、待ちの状態そのものが要らなくなる。
 * 十字キーの上下とスティックだけは項目を選ぶのに使うので、割り当てには入らない。
 */

import Phaser from 'phaser';
import { PAD, VIEW } from '../config';
import { sfx } from '../audio';
import { attachFilm } from '../fx/attachFilm';
import type { FilmPipeline } from '../fx/FilmPipeline';
import { PadInput, PAD_IDLE } from '../input/PadInput';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import {
  PAD_ACTIONS, PLAYER_NAMES, buttonName, padConflicts, saveSettings, settings,
} from '../settings';
import { Rumble } from '../input/Rumble';
import { PAGE_TITLE, buildRows, type Page, type Row } from '../ui/optionRows';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const CREAM = '#f4e6c8';
const INK = '#241a12';
const GOLD = '#ffd76b';
/** 1P・2P の色。機体と計器盤に合わせてある */
const SIDE_COLOR = ['#e8836a', '#8fb6d8'];

/**
 * 割り当てに使えないボタン。十字キーの上下は項目を選ぶのに使う ――
 * ここを取られると、パッドだけでは一覧を動かせなくなる
 */
const RESERVED = [PAD.buttons.up, PAD.buttons.down];

/** 一覧の見た目 */
const TOP = 116;
const STEP = 28;
const LABEL_X = 244;
/** 全体で1つの項目と、人ごとの項目のあいだに空ける高さ（区切り線と見出しが入る） */
const GAP = 30;
/** 人ごとの項目の値を出す位置。全体で1つの項目は左の列だけ使う */
const COL_X = [690, 940];

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

  /** 振動の強さを選んだときに、その場で試す */
  private rumbles = [new Rumble(), new Rumble()];
  /**
   * 前のフレームで押されていたボタン。人ごとに持つ。
   * 割り当ては**押した瞬間**だけ拾う ―― 押しっぱなしのまま項目を移ると、
   * 移った先まで同じボタンで埋まってしまう
   */
  private prevButtons: number[][] = [[], []];
  /**
   * 割り当てを決めた直後。**指を離すまでその人の操作を読まない**。
   *
   * 決めたボタンはまだ押されたままなので、そのまま読むと
   * 「いま決定に割り当てたボタンが押された」ことになって画面が進んでしまう ――
   * 立ち上がりを見ている側（PadInput）は、割り当てが変わる前の別のボタンを
   * 見張っていたので、押しっぱなしでも「今押された」に見える
   */
  private settling = [false, false];

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
    this.settling = [false, false];
    // 入ってきたときに押されていたボタンは「押した瞬間」にしない ――
    // ○A で入った直後の押しっぱなしが、そのまま割り当てにならないように
    this.prevButtons = [this.pressedButtons(0), this.pressedButtons(1)];
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

  /**
   * 並べる項目を作る。中身は `src/ui/optionRows.ts`。
   * 画面を出たり入ったりするたびに作り直すので、値は必ずそのつど `settings` から読む
   */
  private buildRows(): void {
    this.rows = buildRows(this.page, {
      film: () => this.film,
      go: (page) => this.go(page),
      afterReset: () => this.refresh(),
      buzz: (side) => this.rumbles[side].play(
        side, this.pads[side].gamepadIndex, 'strain', this.time.now / 1000,
      ),
    });
  }

  /** 別の画面へ。画面ごとに作り直すので、控えは create で空にしている */
  private go(page: Page): void {
    sfx.menuDecide();
    this.scene.start('Options', { page });
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
      + 'パッドはスティック上下と L / R、決定 ○A・戻る ×B'
      + (this.page === 'pad' ? '　　※割り当ての行では押したボタンがそのまま入ります' : ''), {
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
        const each = r.kind === 'each' || r.kind === 'pad';
        // 人ごとの列は自分のカーソルが乗っているときだけ、
        // 全体で1つの項目は**どちらのカーソルが乗っていても**金色にする ――
        // 列が1つしかないので、2P が選んでいるときに何も光らないのは分かりにくい
        const mine = each ? this.index[c] === i && this.active(c) : on;
        if (r.kind === 'pad') {
          // カーソルが乗っている行は「押せば入る」ことが分かるように挟んで出す
          const name = buttonName(settings.pads[c][r.action]);
          t.setText(mine ? `▸ ${name} ◂` : name);
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
        + '（パッドはそれぞれ自分の列を直します。画面を出るには「戻る」か Esc）'
      : '1P・2P のどちらのパッドでも操作できます');

    // 説明はキーボードが見ている行のもの。二人ぶん出すと下が埋まる
    const here = this.rows[this.index[this.kbSide]];
    this.hint.setText(here?.note ?? '');
    this.hint.setVisible(this.hint.text !== '');
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
    keys.back.on('down', () => this.back());
    keys.swap.on('down', () => this.swapKeyboardSide());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyGuard.detach();
      kb.removeAllKeys(true);
    });
  }

  /** キーボードが直す列を入れ替える。パッド1台でも 2P 側を組めるようにするため */
  private swapKeyboardSide(): void {
    this.kbSide = (this.kbSide + 1) % PLAYER_NAMES.length;
    sfx.menuLevel(1);
    this.refresh();
  }

  private move(side: number, d: -1 | 1): void {
    this.index[side] = (this.index[side] + d + this.rows.length) % this.rows.length;
    sfx.menuMove();
    this.refresh();
  }

  private change(side: number, d: -1 | 1): void {
    const r = this.rows[this.index[side]];
    if (!r) return;
    if (r.kind === 'shared') r.step(d);
    else if (r.kind === 'each') r.step(side, d);
    else return;
    sfx.menuLevel(d);
    this.refresh();
  }

  private decide(side: number): void {
    const r = this.rows[this.index[side]];
    if (!r) return;
    // 割り当ての行は「押したボタンがそのまま入る」ので、決定ですることがない。
    // キーボードの Enter がここへ来たときのために、何をすればよいかだけ出す
    if (r.kind === 'pad') {
      this.hint.setText('パッドの、割り当てたいボタンをそのまま押してください');
      this.hint.setVisible(true);
      return;
    }
    if (r.kind === 'action') { r.run(); return; }
    // 値の項目は決定でも一段進める。左右に気づかなくても変えられるように
    this.change(side, 1);
  }

  /** 画面を出る。どちらが押しても同じ ―― 設定はそのつど保存してあるので、失うものはない */
  private back(): void {
    saveSettings();
    sfx.menuBack();
    // 下の画面からは入口へ、入口からはステージ選択へ戻る
    if (this.page !== 'menu') this.scene.start('Options', { page: 'menu' });
    else this.scene.start('Title');
  }

  /**
   * 割り当ての読み取り。**押したボタンがそのまま入る**。
   *
   * 拾うのは押した瞬間だけ。押しっぱなしのまま項目を移ると、移った先まで
   * 同じボタンで埋まってしまう。十字キーの上下は項目を選ぶのに使うので拾わない。
   *
   * **同じボタンが別の操作に付いていたら入れ替える。**
   * ただし入れ替えるのは**同じ場面で読む操作どうし**だけ（`padConflicts`）――
   * 20mm（飛行中）と決定（画面）のように、同じ場面に出てこないものは
   * 同じボタンに乗っていても困らない。ここを見ずに追い出していたので、
   * 決定に○A を割り当てると 20mm がそこから消えていた
   *
   * @returns 割り当てたか
   */
  private captureButton(side: number, held: number[]): boolean {
    const r = this.rows[this.index[side]];
    if (r?.kind !== 'pad') return false;
    const prev = this.prevButtons[side];
    const button = held.find((b) => !prev.includes(b) && !RESERVED.includes(b));
    if (button === undefined) return false;

    const bind = settings.pads[side];
    const before = bind[r.action];
    if (before !== button) {
      for (const { key } of PAD_ACTIONS) {
        if (key !== r.action && bind[key] === button && padConflicts(key, r.action)) {
          bind[key] = before;
        }
      }
      bind[r.action] = button;
      saveSettings();
    }
    // 押したボタンはまだ押されたまま。指を離すまでこの人の操作は読まない ――
    // 「決定」や「取り消し」を割り当て直した直後に、その押しっぱなしが
    // 決定や取り消しとして効いてしまうのを断つ
    this.settling[side] = true;
    this.padMenus[side].disarm();
    this.padUpHeld[side] = false;
    sfx.menuDecide();
    this.refresh();
    return true;
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
      // その列のパッドが無いときは、キーボードがその列にいる場合だけ1台目を借りる。
      // 借りている間は持ち主の列を触らせない ―― 1台のパッドで両方の列に
      // 同じボタンが入ってしまうため
      const borrowing = !pads[side] && this.kbSide === side;
      const lent = !pads[1] && this.kbSide === 1;
      if (side === 0 && lent && this.rows[this.index[1]]?.kind === 'pad') return out;
      const pad = pads[side] ?? (borrowing ? pads[0] : undefined);
      if (!pad) return out;
      pad.buttons.forEach((b, i) => { if (b.pressed) out.push(i); });
    } catch {
      return out;                    // 読めない環境。割り当ては変えられないだけ
    }
    return out;
  }

  override update(): void {
    this.keyGuard.update();

    // パッドはこのフレームで一度だけ読む（立ち上がりを食べないように）
    this.padStates = this.pads.map((p) => p.read());

    for (let side = 0; side < this.pads.length; side++) {
      const held = this.pressedButtons(side);
      if (this.settling[side]) {
        // 割り当てた直後。指を離すまで読まない
        if (held.length === 0) this.settling[side] = false;
        this.prevButtons[side] = held;
        continue;
      }
      // 割り当ての行にいるなら、押したボタンがそのまま入る。
      // 入ったフレームは、その押しをほかの操作として読まない
      const captured = this.captureButton(side, held);
      this.prevButtons[side] = held;
      if (captured) continue;

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

      const m = this.padMenus[side].read(s);
      // 割り当ての行では、L / R も決定も取り消しも「割り当てるボタン」として扱う。
      // ここまで来ているのは割り当てなかったとき（＝押した瞬間ではないとき）だけ
      if (this.rows[this.index[side]]?.kind === 'pad') continue;
      if (s.rollEdge !== 0) this.change(side, s.rollEdge);
      if (m.decide) this.decide(side);
      else if (m.cancel) this.back();
    }
  }
}
