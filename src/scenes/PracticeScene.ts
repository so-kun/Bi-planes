/**
 * プラクティス。操縦の練習が目的なので、敵も武装も出さない。
 *
 * 番号の付いた輪が空に浮かび、その順に潜っていく。全部潜ればステージ終了。
 * 10 ステージの合計タイムを競い、いちばん短いものをハイスコアとして残す。
 */

import Phaser from 'phaser';
import { FILM_DEFAULT, VIEW } from '../config';
import { sfx } from '../audio';
import { FilmPipeline } from '../fx/FilmPipeline';
import { attachFilm } from '../fx/attachFilm';
import { Particles } from '../fx/Particles';
import { Plane } from '../objects/Plane';
import { Rings } from '../objects/Rings';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import { PadInput, type PadState } from '../input/PadInput';
import { Countdown } from '../ui/Countdown';
import { STAGES, START, formatTime, PRACTICE_STAGES } from '../practice/stages';

const KEY = Phaser.Input.Keyboard.KeyCodes;
const BEST_KEY = 'biplanes.practice.best';
/** ステージを終えてから次が始まるまでの間 */
const INTERVAL = 1.8;

export class PracticeScene extends Phaser.Scene {
  private plane!: Plane;
  private particles!: Particles;
  private rings!: Rings;
  private film: FilmPipeline | null = null;
  private countdown!: Countdown;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyGuard!: StuckKeyGuard;
  private pad = new PadInput(0);
  private padState!: PadState;
  /** パッドでの決定・取り消し・中断。武器と同じボタンなので受け付けを絞る */
  private padMenu = new PadMenu();

  private stageIndex = 0;
  /** 前のフレームの機体位置。輪の面を横切ったかの判定に要る */
  private prev = { x: START.x, y: START.y };
  /** 今のステージの経過時間 */
  private stageTime = 0;
  /** 終わったステージのタイム */
  private times: number[] = [];
  /** ステージ間の待ち。0 なら進行中 */
  private interval = 0;
  private finished = false;
  private best: number | null = null;
  private t = 0;
  private woke = false;
  /** フィルム処理が外れていないか見張る間隔 */
  private filmWatchdog = 1;

  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private centerText!: Phaser.GameObjects.Text;
  private stageName!: Phaser.GameObjects.Text;

  constructor() {
    super('Practice');
  }

  create(): void {
    const bg = this.add.image(0, 0, 'bg-sunset').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    bg.setDepth(0);

    const below = this.add.container(0, 0).setDepth(10);
    const above = this.add.container(0, 0).setDepth(40);
    const fire = this.add.container(0, 0).setDepth(50);
    this.particles = new Particles(this, below, above, fire);

    this.rings = new Rings(this, 20);
    this.plane = new Plane(this, {
      side: 'plane-red', top: 'plane-red-top', under: 'plane-red-under',
    }, START.x, START.y, START.facing);
    this.plane.container.setDepth(30);

    this.best = loadBest();
    this.stageIndex = 0;
    this.times = [];
    this.finished = false;
    this.interval = 0;

    this.setupInput();
    this.setupHud();
    this.setupFilm();

    this.countdown = new Countdown(this);
    this.beginStage();
  }

  // ---------------------------------------------------------------- 進行

  private beginStage(): void {
    const stage = STAGES[this.stageIndex];
    this.rings.load(stage.rings);
    this.plane.reset(START.x, START.y, START.facing);
    this.prev = { x: START.x, y: START.y };
    this.stageTime = 0;
    this.interval = 0;
    this.countdown.begin();
    this.centerText.setVisible(false);
    // 何の練習かを見出しに出す。ステージの狙いが分かっていたほうが身につく
    this.stageName.setText(`ステージ ${this.stageIndex + 1}　${stage.name}`);
  }

  private finishStage(): void {
    this.times.push(this.stageTime);
    sfx.beep(true);
    this.interval = INTERVAL;
    const isLast = this.stageIndex >= PRACTICE_STAGES - 1;
    this.centerText.setText(
      isLast ? '' : `ステージ ${this.stageIndex + 1} クリア\n${formatTime(this.stageTime)}`,
    );
    this.centerText.setVisible(!isLast);
    if (isLast) this.finishAll();
  }

  private finishAll(): void {
    this.finished = true;
    const total = this.times.reduce((a, b) => a + b, 0);
    const isBest = this.best === null || total < this.best;
    if (isBest) {
      this.best = total;
      saveBest(total);
    }
    this.centerText.setText(
      `全10ステージ クリア\n\n合計 ${formatTime(total)}\n`
      + (isBest ? '★ ハイスコア更新 ★' : `ハイスコア ${formatTime(this.best!)}`)
      + '\n\nEnter / ○A でもう一度　　Esc / ×B でタイトルへ',
    );
    // 飛びながら終わるので、指を離すまでパッドを受け付けない
    this.padMenu.disarm();
    this.centerText.setColor(isBest ? '#ffd76b' : '#f4e6c8');
    this.centerText.setVisible(true);
  }

  private toTitle(): void {
    sfx.stopEngines();
    this.scene.start('Title');
  }

  /**
   * パッドでの決定・取り消し・中断。
   *
   * 練習中は Start でタイトルへ、Select でやり直し。この2つは武器と重ならないので、
   * 飛びながら押しても差し支えない。決定と取り消し（○A・×B）は
   * **全10ステージを終えたあとだけ**読む ―― 対戦の画面と同じ扱いにそろえてある
   *
   * @returns 画面を切り替えたか
   */
  private readPadMenu(): boolean {
    const m = this.padMenu.read(this.padState);
    if (m.start) { this.toTitle(); return true; }
    if (this.finished) {
      if (m.decide) { this.restart(); return false; }
      if (m.cancel) { this.toTitle(); return true; }
    } else if (m.select) {
      this.beginStage();
    }
    return false;
  }

  private restart(): void {
    this.stageIndex = 0;
    this.times = [];
    this.finished = false;
    this.padMenu.disarm();
    this.centerText.setColor('#f4e6c8');
    this.beginStage();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.t += dt;
    this.keyGuard.update();
    this.padState = this.pad.read();
    if (!this.woke && this.padState.connected) { this.woke = true; this.wakeAudio(); }
    if (this.readPadMenu()) return;
    this.watchFilm(dt);

    const live = this.countdown.tick();

    if (this.finished) {
      // 終わったあとも機体は飛ばしておく。止まった画面より賑やかで、
      // そのまま操作を試せる
      this.flyPlane(dt, live);
    } else if (this.interval > 0) {
      this.interval -= dt;
      this.flyPlane(dt, live);
      if (this.interval <= 0) {
        this.stageIndex++;
        this.beginStage();
      }
    } else {
      this.flyPlane(dt, live);
      if (live) {
        this.stageTime += dt;
        if (this.rings.check(this.prev.x, this.prev.y, this.plane.x, this.plane.y)) {
          sfx.pop();
          this.particles.popBalloon(this.plane.x, this.plane.y);
          if (this.rings.cleared) this.finishStage();
        }
      }
    }

    this.particles.update(dt);
    this.rings.draw(this.t);
    this.drawHud();
  }

  /** 機体を飛ばす。合図の間は出撃位置で待たせる（対戦と同じ） */
  private flyPlane(dt: number, live: boolean): void {
    this.prev = { x: this.plane.x, y: this.plane.y };
    if (!live) {
      this.plane.state.x = START.x;
      this.plane.state.y = START.y;
      this.plane.state.vx = START.facing * 260;
      this.plane.state.vy = 0;
      this.plane.container.setPosition(START.x, START.y);
      return;
    }
    if (!this.plane.alive) {
      // 練習なので落ちてもすぐ戻す。タイムは止めない（落ちること自体が損）
      this.plane.reset(START.x, START.y, START.facing);
      this.prev = { x: START.x, y: START.y };
      return;
    }
    // 練習では矢印キーも 1P の操作に使える。相手がいないので取り合いにならない
    const k = this.keys;
    const up = k.up.isDown || k.upAlt.isDown;
    const down = k.down.isDown || k.downAlt.isDown;
    // 上下は操縦桿と同じ向き ―― 引く（下）と機首が上がる（2026-08-13 変更）
    const byKey = (down ? 1 : 0) - (up ? 1 : 0);
    const stick = -this.padState.pitch;
    const pitch = Math.abs(stick) > Math.abs(byKey) ? stick : byKey;
    this.plane.setThrottle(k.throttle.isDown || this.padState.throttle ? 1 : 0);
    this.plane.update(pitch, dt);
    // 画面端でつながって飛ぶと位置が大きく跳ぶ。そのまま線分で見ると
    // 通っていない輪を横切ったことになるので、跳んだフレームは見送る
    if (Math.abs(this.plane.x - this.prev.x) > VIEW.width / 2) {
      this.prev = { x: this.plane.x, y: this.plane.y };
    }
    if (this.padState.rollEdge !== 0) this.plane.roll(this.padState.rollEdge);
    if (this.plane.y >= VIEW.groundY) {
      this.particles.explode(this.plane.x, VIEW.groundY, true);
      sfx.explosion();
      this.plane.destroy();
    }
  }

  // ---------------------------------------------------------------- 入力

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      up: KEY.W, down: KEY.S, rollL: KEY.A, rollR: KEY.D,
      throttle: KEY.E,
      upAlt: KEY.UP, downAlt: KEY.DOWN, rollLAlt: KEY.LEFT, rollRAlt: KEY.RIGHT,
      restart: KEY.ENTER, title: KEY.ESC, retry: KEY.R,
      mute: KEY.M, bgm: KEY.B,
      f0: KEY.ONE, f1: KEY.TWO, f2: KEY.THREE, f3: KEY.FOUR, f4: KEY.FIVE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    const wake = (): void => this.wakeAudio();
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    this.keyGuard = new StuckKeyGuard(this.keys);
    this.keyGuard.attach();
    const releaseAll = (): void => { kb.resetKeys(); };
    const onVisibility = (): void => { if (document.hidden) releaseAll(); };
    window.addEventListener('blur', releaseAll);
    window.addEventListener('focus', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    const core = Phaser.Core.Events;
    for (const ev of [core.BLUR, core.FOCUS, core.PAUSE, core.RESUME, core.HIDDEN, core.VISIBLE]) {
      this.game.events.on(ev, releaseAll);
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyGuard.detach();
      sfx.stopEngines();
      this.rings.destroy();
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('focus', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const ev of [core.BLUR, core.FOCUS, core.PAUSE, core.RESUME, core.HIDDEN, core.VISIBLE]) {
        this.game.events.off(ev, releaseAll);
      }
    });

    for (const key of ['rollL', 'rollLAlt']) this.keys[key].on('down', () => this.plane.roll(-1));
    for (const key of ['rollR', 'rollRAlt']) this.keys[key].on('down', () => this.plane.roll(1));
    this.keys.restart.on('down', () => { if (this.finished) this.restart(); });
    this.keys.retry.on('down', () => { if (!this.finished) this.beginStage(); });
    this.keys.title.on('down', () => this.toTitle());
    this.keys.mute.on('down', () => sfx.toggleMute());
    this.keys.bgm.on('down', () => sfx.toggleBgm());
    // ステージ選択の曲を引きずらないよう、ここで対戦と同じ曲に入れ替える
    sfx.playBgm('battle');
    for (let i = 0; i < 5; i++) this.keys[`f${i}`].on('down', () => this.film?.setLevel(i));
  }

  private wakeAudio(): void {
    sfx.resume();
    sfx.startEngines(1);
    sfx.setEngine(0, 2, false);
  }

  // ---------------------------------------------------------------- 表示

  private setupHud(): void {
    this.hud = this.add.graphics().setDepth(70);
    this.hudText = this.add.text(0, 0, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '20px', color: '#241a12',
      align: 'center',
    }).setOrigin(0.5, 0).setDepth(71);

    this.stageName = this.add.text(VIEW.width / 2, 92, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '22px', color: '#f4e6c8',
      stroke: '#241a12', strokeThickness: 5,
    }).setOrigin(0.5, 0).setDepth(71);

    this.centerText = this.add.text(VIEW.width / 2, VIEW.height / 2 - 40, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '38px', color: '#f4e6c8',
      align: 'center', stroke: '#241a12', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(74).setVisible(false);

    this.add.text(VIEW.width / 2, VIEW.height - 26,
      '矢印の向きに輪をくぐる（順番どおりに）　　S/W・↓↑ 機首上げ下げ　　A/D・←→ ロール　　E 全開　　'
      + 'R / パッド Select やり直し　　Esc / パッド Start タイトルへ', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f4e6c8',
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setDepth(71).setAlpha(0.9);
  }

  private drawHud(): void {
    const g = this.hud;
    g.clear();
    const w = 330;
    const x = (VIEW.width - w) / 2;
    g.fillStyle(0xf4e6c8, 1).lineStyle(5, 0x241a12, 1);
    g.fillRoundedRect(x, 18, w, 62, 9);
    g.strokeRoundedRect(x, 18, w, 62, 9);

    const total = this.times.reduce((a, b) => a + b, 0) + (this.finished ? 0 : this.stageTime);
    this.hudText.setPosition(VIEW.width / 2, 26);
    this.hudText.setText(
      `ステージ ${Math.min(this.stageIndex + 1, PRACTICE_STAGES)} / ${PRACTICE_STAGES}`
      + `　　輪 のこり ${this.rings.remaining}\n`
      + `合計 ${formatTime(total)}`
      + (this.best !== null ? `　　ハイスコア ${formatTime(this.best)}` : ''),
    );
  }

  private setupFilm(): void {
    this.film = attachFilm(this, this.film?.getLevel() ?? FILM_DEFAULT);
  }

  private watchFilm(dt: number): void {
    if (!(this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    this.filmWatchdog -= dt;
    if (this.filmWatchdog > 0) return;
    this.filmWatchdog = 1;
    if (this.cameras.main.getPostPipeline(FilmPipeline)) return;
    this.setupFilm();          // 強さは掛け直しても引き継がれる
  }

}

/** ハイスコアの読み書き。使えない環境（プライベートモード等）でも落ちないようにする */
function loadBest(): number | null {
  try {
    const v = window.localStorage?.getItem(BEST_KEY);
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveBest(total: number): void {
  try {
    window.localStorage?.setItem(BEST_KEY, String(total));
  } catch {
    // 保存できなくても遊べる。黙って続ける
  }
}
