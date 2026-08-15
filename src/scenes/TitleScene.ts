/**
 * ステージ選択。オープニングのあとに出て、遊び方を選んでから始める。
 *
 * 背景はオープニングと同じ絵から、ロゴと機体を外したもの。
 * 1人・2人・プラクティス・フリープレイの4つと、コンピュータの腕前を選ぶ。
 * 上下で遊び方、左右で腕前。決定は Enter（パッドは ○／A）、戻るは Esc（×／B）。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';
import { AI_LEVELS } from '../ai/Pilot';
import { sfx } from '../audio';
import { attachFilm } from '../fx/attachFilm';
import { PadInput } from '../input/PadInput';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import { settings } from '../settings';

const KEY = Phaser.Input.Keyboard.KeyCodes;

/** 遊び方。ai は 0 = 人、1..3 = コンピュータの腕前 */
interface Mode {
  name: string;
  note: string;
  /** 移る画面。プラクティスとオプションは別の画面へ行く */
  scene: 'Play' | 'Practice' | 'Options';
  /** 相手を出さず、一人で飛ぶだけにするか */
  free?: boolean;
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
  { name: 'フリープレイ', note: '相手なし。一人で飛ぶだけ', scene: 'Play', usesAi: false, free: true,
    p1Ai: () => 0, p2Ai: () => 0 },
  { name: 'オプション', note: 'パッドの割り当て・音量・見た目・ルール', scene: 'Options', usesAi: false,
    p1Ai: () => 0, p2Ai: () => 0 },
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
  private padMenu = new PadMenu();
  private padUpHeld = false;
  private started = false;
  /**
   * ここにも押しっぱなしの見張りを付ける。Phaser は押しっぱなしのキーには
   * 押した合図を出さないので、離した合図をひとつ取りこぼすと、
   * そのキーは二度と反応しなくなる ―― メニューが動かなくなる
   */
  private keyGuard!: StuckKeyGuard;

  constructor() {
    super('Title');
  }

  create(): void {
    // 画面を作り直すたびに戻す。Phaser は作り直しでも構築子を呼ばないので、
    // ここで戻さないと対戦から帰ってきたときに二度と始められなくなる。
    // 遊び方と腕前はあえて残す ―― 前回選んだものがそのまま出るほうが早い
    this.started = false;
    this.padUpHeld = false;
    // 前の画面で押したボタンが残っていても、指を離すまで反応しない
    this.padMenu.disarm();

    const bg = this.add.image(0, 0, 'title-bg').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    // 文字を読ませたいので、背景は一枚かぶせて落ち着かせる。
    // 濃くしすぎると絵が灰色になってしまうので、字に縁取りを付けたぶん薄めにする
    this.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x10233a, 0.32).setOrigin(0);

    // ステージ選択の曲。対戦の曲とは別の行進曲で、対戦に入ると自動で入れ替わる。
    // 音を鳴らせるのはオープニングで何か押されたあとなので、ここでは通るだけのこともある
    sfx.playBgm('menu');

    attachFilm(this);
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
      '↑ ↓ 遊び方　　← → 腕前　　Enter 決定　　Esc 戻る', {
        fontFamily: 'Georgia, serif', fontSize: '20px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.55)', padding: { x: 16, y: 7 },
      }).setOrigin(0.5);
    this.add.text(cx, VIEW.height - 46,
      'パッドはスティック上下で選び、○／A で決定・×／B で戻る　　'
      + (settings.pullToClimb[0] ? '機首は引くと上がる（S・↓ で上昇）' : '機首は倒すと上がる（W・↑ で上昇）')
      + '　　1P W/S・A/D・E・F・G　　2P ↑↓・←→・Shift・, ・.', {
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

    this.keyGuard = new StuckKeyGuard(keys);
    this.keyGuard.attach();

    // ブラウザは操作があるまで音を鳴らせない。ここで起こして、曲も鳴らしはじめる
    const wake = (): void => { sfx.resume(); sfx.playBgm('menu'); };
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    for (const k of ['up', 'w']) keys[k].on('down', () => this.move(-1));
    for (const k of ['down', 's']) keys[k].on('down', () => this.move(1));
    for (const k of ['left', 'a']) keys[k].on('down', () => this.pick(-1));
    for (const k of ['right', 'd']) keys[k].on('down', () => this.pick(1));
    for (const k of ['enter', 'space']) keys[k].on('down', () => this.start());
    keys.back.on('down', () => this.back());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyGuard.detach();
      kb.removeAllKeys(true);
    });
  }

  private move(d: number): void {
    this.mode = (this.mode + d + MODES.length) % MODES.length;
    sfx.menuMove();
    this.refresh();
  }

  private pick(d: number): void {
    const next = Phaser.Math.Clamp(this.level + d, 1, AI_LEVELS.length);
    // 端で止まっているときは鳴らさない。変わっていないのに音がするとうるさい
    if (next !== this.level) sfx.menuLevel(d < 0 ? -1 : 1);
    this.level = next;
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

  private back(): void {
    if (this.started) return;
    sfx.menuBack();
    this.scene.start('Opening');
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    sfx.resume();
    sfx.menuDecide();
    const m = MODES[this.mode];
    if (m.scene === 'Play') {
      this.scene.start('Play', { p1Ai: m.p1Ai(this.level), p2Ai: m.p2Ai(this.level), free: m.free });
    } else {
      this.scene.start(m.scene);
    }
  }

  override update(): void {
    this.keyGuard.update();
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

    const m = this.padMenu.read(s);
    if (m.decide || m.start) this.start();
    if (m.cancel) this.back();
  }

}
