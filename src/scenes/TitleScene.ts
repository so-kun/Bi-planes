/**
 * ステージ選択。オープニングのあとに出て、遊び方を選んでから始める。
 *
 * 背景はオープニングと同じ絵から、ロゴと機体を外したもの。
 * 1人・2人・プラクティス・デモの4つと、コンピュータの腕前を選ぶ。
 * 上下で遊び方、左右で腕前。決定は Enter か Space、パッドなら ○／A。
 */

import Phaser from 'phaser';
import { VIEW, FILM_DEFAULT } from '../config';
import { AI_LEVELS } from '../ai/Pilot';
import { sfx } from '../audio';
import { FilmPipeline } from '../fx/FilmPipeline';
import { PadInput } from '../input/PadInput';

const KEY = Phaser.Input.Keyboard.KeyCodes;

/** 遊び方。ai は 0 = 人、1..3 = コンピュータの腕前 */
interface Mode {
  name: string;
  note: string;
  /** 移る画面。プラクティスだけ別の画面へ行く */
  scene: 'Play' | 'Practice';
  /** 腕前の選択が効くか。効かないものは薄く表示する */
  usesAi: boolean;
  p1Ai: (level: number) => number;
  p2Ai: (level: number) => number;
}

const MODES: Mode[] = [
  { name: '1人で遊ぶ', note: '2P はコンピュータ', scene: 'Play', usesAi: true,
    p1Ai: () => 0, p2Ai: (lv) => lv },
  { name: '2人で対戦', note: '1台のキーボード、またはパッド2台', scene: 'Play', usesAi: false,
    p1Ai: () => 0, p2Ai: () => 0 },
  { name: 'プラクティス', note: '輪をくぐって操縦を練習・全10ステージ', scene: 'Practice', usesAi: false,
    p1Ai: () => 0, p2Ai: () => 0 },
  { name: 'デモを見る', note: 'コンピュータどうしの空戦', scene: 'Play', usesAi: true,
    p1Ai: (lv) => lv, p2Ai: (lv) => lv },
];

const CREAM = '#f4e6c8';
const INK = '#241a12';

export class TitleScene extends Phaser.Scene {
  private mode = 0;
  private level = 2;
  private modeTexts: Phaser.GameObjects.Text[] = [];
  private noteTexts: Phaser.GameObjects.Text[] = [];
  private levelTexts: Phaser.GameObjects.Text[] = [];
  private levelLabel!: Phaser.GameObjects.Text;
  private cursor!: Phaser.GameObjects.Text;
  private pad = new PadInput(0);
  private padUpHeld = false;
  private started = false;

  constructor() {
    super('Title');
  }

  create(): void {
    // 画面を作り直すたびに戻す。Phaser は作り直しでも構築子を呼ばないので、
    // ここで戻さないと対戦から帰ってきたときに二度と始められなくなる。
    // 遊び方と腕前はあえて残す ―― 前回選んだものがそのまま出るほうが早い
    this.started = false;
    this.padUpHeld = false;

    const bg = this.add.image(0, 0, 'title-bg').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    // 文字を読ませたいので、背景は一枚かぶせて落ち着かせる。
    // 濃くしすぎると絵が灰色になってしまうので、字に縁取りを付けたぶん薄めにする
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x10233a, 0.32).setOrigin(0);

    this.setupFilm();
    this.drawMarquee();
    this.drawMenu();
    this.setupInput();
    this.refresh();
  }

  private drawMarquee(): void {
    const cx = VIEW.width / 2;
    const g = this.add.graphics();
    g.fillStyle(0xf4e6c8, 1).lineStyle(6, 0x241a12, 1);
    g.fillRoundedRect(cx - 300, 52, 600, 132, 12);
    g.strokeRoundedRect(cx - 300, 52, 600, 132, 12);

    this.add.text(cx, 82, 'BATTLE PLANES', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '50px', color: INK,
    }).setOrigin(0.5, 0);
    this.add.text(cx, 146, '遊び方を選んでください', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '20px', color: '#5b4632',
    }).setOrigin(0.5, 0);
    for (const dx of [-268, 268]) {
      this.add.text(cx + dx, 112, '★', {
        fontFamily: 'Georgia, serif', fontSize: '22px', color: '#a8402c',
      }).setOrigin(0.5);
    }
  }

  private drawMenu(): void {
    const cx = VIEW.width / 2;
    const top = 238;
    MODES.forEach((m, i) => {
      const y = top + i * 58;
      this.modeTexts[i] = this.add.text(cx - 150, y, m.name, {
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '32px', color: CREAM,
        stroke: INK, strokeThickness: 5,
      }).setOrigin(0, 0.5);
      this.noteTexts[i] = this.add.text(cx + 90, y + 3, m.note, {
        fontFamily: 'Georgia, serif', fontSize: '16px', color: CREAM,
      }).setOrigin(0, 0.5).setAlpha(0.7);
    });

    this.cursor = this.add.text(0, 0, '▶', {
      fontFamily: 'Georgia, serif', fontSize: '30px', color: '#d59a34',
      stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5);

    // 腕前
    const ly = top + MODES.length * 58 + 16;
    this.levelLabel = this.add.text(cx - 150, ly, 'コンピュータの腕前', {
      fontFamily: 'Georgia, serif', fontSize: '18px', color: CREAM, stroke: INK, strokeThickness: 4,
    }).setOrigin(0, 0.5);
    AI_LEVELS.forEach((lv, i) => {
      this.levelTexts[i] = this.add.text(cx + 40 + i * 78, ly, lv.name, {
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '26px', color: CREAM,
        stroke: INK, strokeThickness: 5,
      }).setOrigin(0.5);
    });

    // 下段は地面の絵に重なって読めなくなるので、どちらも敷き紙を挟む
    this.add.text(cx, VIEW.height - 96,
      '↑ ↓ 遊び方　　← → 腕前　　Enter 決定　　Esc タイトルへ', {
        fontFamily: 'Georgia, serif', fontSize: '20px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.55)', padding: { x: 16, y: 7 },
      }).setOrigin(0.5);
    this.add.text(cx, VIEW.height - 46,
      'パッドはスティック上下で選び、○／A で決定　　'
      + '機首は引くと上がる（S・↓ で上昇）　　1P W/S・A/D・E・F・G　　2P ↑↓・←→・Shift・, ・.', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setAlpha(0.85);
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    const keys = kb.addKeys({
      up: KEY.UP, down: KEY.DOWN, left: KEY.LEFT, right: KEY.RIGHT,
      w: KEY.W, s: KEY.S, a: KEY.A, d: KEY.D,
      enter: KEY.ENTER, space: KEY.SPACE, back: KEY.ESC,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // ブラウザは操作があるまで音を鳴らせない。タイトルで触ってもらえれば
    // 対戦に入る頃には BGM が鳴っている
    const wake = (): void => { sfx.resume(); };
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    for (const k of ['up', 'w']) keys[k].on('down', () => this.move(-1));
    for (const k of ['down', 's']) keys[k].on('down', () => this.move(1));
    for (const k of ['left', 'a']) keys[k].on('down', () => this.pick(-1));
    for (const k of ['right', 'd']) keys[k].on('down', () => this.pick(1));
    for (const k of ['enter', 'space']) keys[k].on('down', () => this.start());
    keys.back.on('down', () => { if (!this.started) this.scene.start('Opening'); });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { kb.removeAllKeys(true); });
  }

  private move(d: number): void {
    this.mode = (this.mode + d + MODES.length) % MODES.length;
    this.refresh();
  }

  private pick(d: number): void {
    this.level = Phaser.Math.Clamp(this.level + d, 1, AI_LEVELS.length);
    this.refresh();
  }

  private refresh(): void {
    MODES.forEach((_, i) => {
      const on = i === this.mode;
      this.modeTexts[i].setColor(on ? '#ffd76b' : CREAM);
      this.modeTexts[i].setAlpha(on ? 1 : 0.62);
      this.noteTexts[i].setAlpha(on ? 0.85 : 0.4);
    });
    const t = this.modeTexts[this.mode];
    this.cursor.setPosition(t.x - 34, t.y);

    // 腕前を使わない遊び方では薄くして「効かない」ことを示す
    const usesAi = MODES[this.mode].usesAi;
    this.levelLabel.setAlpha(usesAi ? 0.9 : 0.3);
    AI_LEVELS.forEach((_, i) => {
      const on = usesAi && i === this.level - 1;
      this.levelTexts[i].setColor(on ? '#ffd76b' : CREAM);
      this.levelTexts[i].setAlpha(usesAi ? (on ? 1 : 0.5) : 0.25);
    });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    sfx.resume();
    sfx.beep(true);
    const m = MODES[this.mode];
    if (m.scene === 'Practice') this.scene.start('Practice');
    else this.scene.start('Play', { p1Ai: m.p1Ai(this.level), p2Ai: m.p2Ai(this.level) });
  }

  override update(): void {
    // パッドでも選べるようにする。スティックは倒しっぱなしで送り続けないよう、
    // 中立に戻るまで次を受け付けない
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
    if (s.rollEdge !== 0) this.pick(s.rollEdge);
    if (s.cannonEdge) this.start();
  }

  private setupFilm(): void {
    const renderer = this.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    if (!renderer.pipelines.has('Film')) renderer.pipelines.addPostPipeline('Film', FilmPipeline);
    this.cameras.main.setPostPipeline(FilmPipeline);
    const film = this.cameras.main.getPostPipeline(FilmPipeline) as FilmPipeline;
    film?.setLevel(FILM_DEFAULT);
  }
}
