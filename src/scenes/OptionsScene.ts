/**
 * オプション画面。ステージ選択から入る。
 *
 * 中身は「一列に並んだ項目」だけ。上下で選び、左右で値を変える ――
 * パッドのボタン割り当てだけは、決定してから**割り当てたいボタンを押す**。
 *
 * 変えたそばから効く（音量もフィルムもその場で変わる）ようにして、
 * 「決定」を押さないと反映されない作りは避けた。設定はそのつど保存する。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';
import { sfx } from '../audio';
import { attachFilm } from '../fx/attachFilm';
import type { FilmPipeline } from '../fx/FilmPipeline';
import { PadInput } from '../input/PadInput';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import {
  PAD_ACTIONS, buttonName, resetSettings, saveSettings, settings, type PadBinding,
} from '../settings';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const CREAM = '#f4e6c8';
const INK = '#241a12';

/** 一覧に並ぶもの。値を持つ項目と、押すだけの項目がある */
type Row =
  | { kind: 'pad'; label: string; action: keyof PadBinding }
  | { kind: 'choice'; label: string; get: () => string; step: (d: -1 | 1) => void; note?: string }
  | { kind: 'action'; label: string; run: () => void; note?: string };

/** 選べる値。左右で前後に動かす */
const DEADZONES = [0.10, 0.15, 0.22, 0.30, 0.40];
const FILM_NAMES = ['切', '弱', '既定', '標準', '強'];
const WINNING = [10, 15, 20, 30, 50];

/** ボタンの割り当て待ちを打ち切るまでの秒数 */
const WAIT_LIMIT = 8;

/** 一覧の見た目。16 行が下の案内に掛からないように詰めてある */
const TOP = 130;
const STEP = 30;
const LABEL_X = 300;
const VALUE_X = 790;

export class OptionsScene extends Phaser.Scene {
  private rows: Row[] = [];
  private texts: { label: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text }[] = [];
  private cursor!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private index = 0;
  private film: FilmPipeline | null = null;

  private pad = new PadInput(0);
  private padMenu = new PadMenu();
  private padUpHeld = false;
  private keyGuard!: StuckKeyGuard;

  /**
   * ボタンの割り当て待ち。null なら待っていない。
   * 待っている間はほかの操作を受け付けない ―― 割り当てたいボタンが
   * 「決定」や「取り消し」と重なることがあるため
   */
  private waiting: keyof PadBinding | null = null;
  /** 待ちに入った時点で押されていたボタン。いったん全部離すまで拾わない */
  private waitArmed = false;
  /** 待ちはじめてからの秒数。押されないまま置き去りにならないよう打ち切る */
  private waitTimer = 0;

  constructor() {
    super('Options');
  }

  create(): void {
    this.index = 0;
    this.waiting = null;
    this.padUpHeld = false;
    this.padMenu.disarm();

    const bg = this.add.image(0, 0, 'title-bg').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x10233a, 0.55).setOrigin(0);

    this.add.text(VIEW.width / 2, 66, 'オプション', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '40px', color: CREAM,
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

    this.rows = [
      { kind: 'choice',
        label: '機首の向き',
        note: '「引くと上げ」は操縦桿と同じ向き',
        get: () => (settings.pullToClimb ? '引くと上げ' : '倒すと上げ'),
        step: () => { settings.pullToClimb = !settings.pullToClimb; saveSettings(); } },
      { kind: 'choice',
        label: 'スティックの遊び',
        note: '中央の、倒していないとみなす幅。大きいほど手が休まる',
        get: () => settings.deadzone.toFixed(2),
        step: (d) => {
          settings.deadzone = cycle(DEADZONES, DEADZONES.reduce(
            (a, b) => (Math.abs(b - settings.deadzone) < Math.abs(a - settings.deadzone) ? b : a),
          ), d);
          saveSettings();
        } },
      { kind: 'choice',
        label: '音量',
        get: () => `${Math.round(settings.volume * 100)}%`,
        step: (d) => {
          settings.volume = Math.min(1, Math.max(0, Math.round((settings.volume + d * 0.1) * 10) / 10));
          sfx.applyVolume();
          saveSettings();
        } },
      { kind: 'choice',
        label: 'BGM',
        get: () => (settings.bgm ? '入' : '切'),
        step: () => { settings.bgm = !settings.bgm; sfx.applyBgmSetting(); saveSettings(); } },
      { kind: 'choice',
        label: 'フィルムの強さ',
        note: '古いフィルム風の粒とゆらぎ。切ると絵がそのまま出る',
        get: () => FILM_NAMES[settings.film] ?? String(settings.film),
        step: (d) => {
          settings.film = (settings.film + d + FILM_NAMES.length) % FILM_NAMES.length;
          this.film?.setLevel(settings.film);
          saveSettings();
        } },
      { kind: 'choice',
        label: '勝ちに必要な点',
        get: () => `${settings.winning} 点`,
        step: (d) => { settings.winning = cycle(WINNING, settings.winning, d); saveSettings(); } },
      ...PAD_ACTIONS.map((a): Row => ({ kind: 'pad', label: `パッド　${a.label}`, action: a.key })),
      { kind: 'action',
        label: '初期設定に戻す',
        note: 'すべての項目を最初の状態へ',
        run: () => {
          resetSettings();
          sfx.applyVolume();
          sfx.applyBgmSetting();
          this.film?.setLevel(settings.film);
          sfx.menuDecide();
          this.refresh();
        } },
    ];
  }

  private layout(): void {
    this.cursor = this.add.text(LABEL_X - 30, TOP, '▶', {
      fontFamily: 'Georgia, serif', fontSize: '18px', color: '#ffd76b',
      stroke: INK, strokeThickness: 4,
    }).setOrigin(0.5);

    this.rows.forEach((r, i) => {
      const y = TOP + i * STEP;
      const label = this.add.text(LABEL_X, y, r.label, {
        fontFamily: 'Georgia, serif', fontSize: '19px', color: CREAM,
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0, 0.5);
      const value = this.add.text(VALUE_X, y, '', {
        fontFamily: 'Georgia, serif', fontSize: '19px', color: CREAM,
        stroke: INK, strokeThickness: 4,
      }).setOrigin(0, 0.5);
      this.texts.push({ label, value });
    });

    // 選んでいる項目の説明。下に一行だけ出す（項目ごとに出すと画面が埋まる）
    this.hint = this.add.text(VIEW.width / 2, VIEW.height - 98, '', {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#ffd76b',
      backgroundColor: 'rgba(24,16,10,0.62)', padding: { x: 14, y: 5 },
    }).setOrigin(0.5);

    this.add.text(VIEW.width / 2, VIEW.height - 56,
      '↑ ↓ 項目　　← → 変更　　Enter 決定　　Esc 戻る　　'
      + 'パッドはスティック上下と L / R、決定 ○A・戻る ×B', {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.55)', padding: { x: 14, y: 5 },
      }).setOrigin(0.5);

    this.add.text(VIEW.width / 2, VIEW.height - 20,
      '機首のスティック（左スティック上下・十字キー）とキーボードの割り当ては変えられません', {
        fontFamily: 'Georgia, serif', fontSize: '14px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 4 },
      }).setOrigin(0.5).setAlpha(0.72);
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      const on = i === this.index;
      const t = this.texts[i];
      t.label.setColor(on ? '#ffd76b' : CREAM);
      t.label.setAlpha(on ? 1 : 0.72);
      t.value.setAlpha(on ? 1 : 0.72);
      if (r.kind === 'pad') {
        const waiting = this.waiting === r.action;
        t.value.setText(waiting ? '― 割り当てたいボタンを押す ―' : buttonName(settings.pad[r.action]));
        t.value.setColor(waiting ? '#ffd76b' : on ? '#ffd76b' : CREAM);
      } else if (r.kind === 'choice') {
        t.value.setText(`◂ ${r.get()} ▸`);
        t.value.setColor(on ? '#ffd76b' : CREAM);
      } else {
        t.value.setText('');
      }
    });
    this.cursor.setY(TOP + this.index * STEP);

    const r = this.rows[this.index];
    let hint = '';
    if (this.waiting) hint = '割り当てたいボタンを押してください（Esc でやめる）';
    else if (r.kind === 'pad') hint = 'Enter（○A）を押してから、割り当てたいボタンを押します';
    else if (r.kind !== 'action' && r.note) hint = r.note;
    else if (r.kind === 'action' && r.note) hint = r.note;
    this.hint.setText(hint);
    this.hint.setVisible(hint !== '');
  }

  // ---------------------------------------------------------------- 入力

  private setupInput(): void {
    const kb = this.input.keyboard!;
    const keys = kb.addKeys({
      up: KEY.UP, down: KEY.DOWN, left: KEY.LEFT, right: KEY.RIGHT,
      w: KEY.W, s: KEY.S, a: KEY.A, d: KEY.D,
      enter: KEY.ENTER, space: KEY.SPACE, back: KEY.ESC,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    this.keyGuard = new StuckKeyGuard(keys);
    this.keyGuard.attach();

    const wake = (): void => { sfx.resume(); sfx.playBgm('menu'); };
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    for (const k of ['up', 'w']) keys[k].on('down', () => this.move(-1));
    for (const k of ['down', 's']) keys[k].on('down', () => this.move(1));
    for (const k of ['left', 'a']) keys[k].on('down', () => this.change(-1));
    for (const k of ['right', 'd']) keys[k].on('down', () => this.change(1));
    for (const k of ['enter', 'space']) keys[k].on('down', () => this.decide());
    keys.back.on('down', () => this.back());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyGuard.detach();
      kb.removeAllKeys(true);
    });
  }

  private move(d: -1 | 1): void {
    if (this.waiting) return;
    this.index = (this.index + d + this.rows.length) % this.rows.length;
    sfx.menuMove();
    this.refresh();
  }

  private change(d: -1 | 1): void {
    if (this.waiting) return;
    const r = this.rows[this.index];
    if (r.kind !== 'choice') return;
    r.step(d);
    sfx.menuLevel(d);
    this.refresh();
  }

  private decide(): void {
    const r = this.rows[this.index];
    if (this.waiting) return;
    if (r.kind === 'pad') {
      this.waiting = r.action;
      this.waitArmed = false;
      this.waitTimer = 0;
      sfx.menuDecide();
      this.refresh();
      return;
    }
    if (r.kind === 'action') { r.run(); return; }
    // 値の項目は決定でも一段進める。左右に気づかなくても変えられるように
    this.change(1);
  }

  private back(): void {
    if (this.waiting) {
      this.waiting = null;
      sfx.menuBack();
      this.refresh();
      return;
    }
    saveSettings();
    sfx.menuBack();
    this.scene.start('Title');
  }

  /**
   * 割り当て待ちの間の読み取り。
   *
   * 押されたボタンをそのまま割り当てる。**同じボタンが別の操作に付いていたら入れ替える** ――
   * 消さずに残すと、二つの操作が同時に出て収拾がつかなくなる。
   * 決定に使ったボタンをそのまま拾わないよう、一度すべて離すまで待つ
   */
  private captureButton(dt: number): void {
    const held = this.pressedButtons();
    if (!this.waitArmed) {
      if (held.length === 0) this.waitArmed = true;
      return;
    }
    this.waitTimer += dt;
    if (held.length === 0) {
      // パッドだけで遊んでいて、押せるボタンが無くなった場合の逃げ道。
      // キーボードがあれば Esc でやめられるが、無いと待ちから出られなくなる
      if (this.waitTimer > WAIT_LIMIT) {
        this.waiting = null;
        sfx.menuBack();
        this.refresh();
      }
      return;
    }

    const button = held[0];
    const action = this.waiting!;
    const before = settings.pad[action];
    // 同じボタンを使っている操作があれば、そちらに今までのボタンを渡す
    for (const { key } of PAD_ACTIONS) {
      if (key !== action && settings.pad[key] === button) settings.pad[key] = before;
    }
    settings.pad[action] = button;
    saveSettings();
    this.waiting = null;
    sfx.menuDecide();
    this.refresh();
  }

  /** いま押されているボタンの番号 */
  private pressedButtons(): number[] {
    const out: number[] = [];
    try {
      if (!navigator.getGamepads) return out;
      for (const p of navigator.getGamepads()) {
        if (!p || !p.connected || p.mapping !== 'standard') continue;
        p.buttons.forEach((b, i) => { if (b.pressed) out.push(i); });
        break;                       // 1台目だけ見る
      }
    } catch {
      return out;                    // 読めない環境。割り当ては変えられないだけ
    }
    return out;
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.keyGuard.update();

    if (this.waiting) {
      this.captureButton(dt);
      return;                        // 待っている間はほかの操作を読まない
    }

    const s = this.pad.read();
    if (!s.connected) return;
    if (Math.abs(s.pitch) > 0.5) {
      if (!this.padUpHeld) {
        this.padUpHeld = true;
        this.move(s.pitch > 0 ? -1 : 1);   // スティックを上に倒すと pitch は正
      }
    } else {
      this.padUpHeld = false;
    }
    if (s.rollEdge !== 0) this.change(s.rollEdge);

    const m = this.padMenu.read(s);
    if (m.decide) this.decide();
    else if (m.cancel) this.back();
  }
}
