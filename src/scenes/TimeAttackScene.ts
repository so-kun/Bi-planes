/**
 * タイムアタック。番号の付いた輪を順にくぐり、**10ステージの合計タイム**を競う。
 *
 * もとは「プラクティス」という練習の場だったが、遊びの芯はタイムそのものなので
 * 名前と作りをタイムに寄せた（2026-08-15 改定）:
 *
 * - 計器盤を対戦と同じ真鍮の板で出す（TIME・のこりの輪・水温）
 * - **自爆はタイムに +3 秒**。落ちてもすぐ戻れるぶん、代償を時間で払わせる
 * - 終わったら、ステージごとのタイムと自爆の回数を並べて見せる
 *
 * 敵も武装も出ない。輪には**くぐる向き**があり、面をその向きに横切ったときだけ通る。
 */

import Phaser from 'phaser';
import { VIEW, groundAt } from '../config';
import { settings, saveSettings } from '../settings';
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
import { Panel, PANEL } from '../ui/Panel';
import { ScorePops } from '../ui/ScorePops';
import { PauseMenu } from '../ui/PauseMenu';
import { STAGES, START, formatTime, STAGE_COUNT } from '../timeattack/stages';

/** のこりの輪の帯。体力と違って減っても不吉に見えないよう、真鍮の色でそろえる */
const RING_BAR = [0xd59a34, 0xd59a34, 0xd8b134, 0xd8b134, 0xcfba3c, 0xcfba3c, 0xc9c05a, 0xc9c05a];

const KEY = Phaser.Input.Keyboard.KeyCodes;
const BEST_KEY = 'biplanes.practice.best';
/** ステージを終えてから次が始まるまでの間 */
const INTERVAL = 1.8;
/**
 * 自爆したときにタイムへ足す秒数。
 * すぐ出撃位置へ戻れるので、地面すれすれを 攻めるほうが速い、という抜け道を塞ぐ
 */
const CRASH_PENALTY = 3;

export class TimeAttackScene extends Phaser.Scene {
  private plane!: Plane;
  private particles!: Particles;
  private rings!: Rings;
  private film: FilmPipeline | null = null;
  private countdown!: Countdown;
  /** ＋（Start）や Esc で出る、終了の確認 */
  private pause!: PauseMenu;
  /** 一時停止の画面で、スティックを倒しっぱなしにしても1度しか動かさないための記録 */
  private menuHeld = false;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private keyGuard!: StuckKeyGuard;
  private pad = new PadInput(0);
  private padState!: PadState;
  /** パッドでの決定・取り消し・中断。武器と同じボタンなので受け付けを絞る */
  private padMenu = new PadMenu();

  private stageIndex = 0;
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

  /** 計器盤。対戦と同じ板を、出すものだけ変えて使う */
  private panel!: Panel;
  /** ステージと自爆とハイスコアを添える一行 */
  private hudText!: Phaser.GameObjects.Text;
  /** 自爆したときの「+3.00」を出す */
  private pops!: ScorePops;
  /** 自爆した回数。結果に出す */
  private crashes = 0;
  private centerText!: Phaser.GameObjects.Text;
  private stageName!: Phaser.GameObjects.Text;

  constructor() {
    super('TimeAttack');
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

    // **画面は作り直されても構築子は呼ばれない。** class の初期値が働くのは最初の一度きりなので、
    // 持ち越すと困るものはここで必ず戻す ―― woke を戻し忘れると、
    // 画面を出るときに止めたエンジン音が二度と鳴らなくなり、
    // film を戻し忘れると、オプションで変えたフィルムの強さが効かなくなる
    this.best = loadBest();
    this.stageIndex = 0;
    this.times = [];
    this.stageTime = 0;
    this.finished = false;
    this.interval = 0;
    this.t = 0;
    this.woke = false;
    this.film = null;
    this.filmWatchdog = 1;
    this.menuHeld = false;
    this.crashes = 0;

    this.setupInput();
    this.setupHud();
    this.setupFilm();

    this.countdown = new Countdown(this);
    this.pause = new PauseMenu(this);
    // 音がもう起きていれば、ここでエンジンも曲も鳴りはじめる
    this.wakeAudio();
    this.beginStage();
  }

  // ---------------------------------------------------------------- 進行

  private beginStage(): void {
    const stage = STAGES[this.stageIndex];
    this.rings.load(stage.rings);
    this.plane.reset(START.x, START.y, START.facing);
    this.stageTime = 0;
    this.interval = 0;
    this.countdown.begin();
    this.centerText.setVisible(false);
    // 何の練習かを見出しに出す。ステージの狙いが分かっていたほうが身につく
    this.stageName.setText(`ステージ ${this.stageIndex + 1}　${stage.name}`);
  }

  /**
   * 自爆の代償。**タイムに 3 秒足す**。
   * すぐ出撃位置へ戻れるので、時間で払わせないと「落ちたほうが速い」場面ができてしまう。
   * 走っていないとき（ステージの合間・終わったあと）は取らない
   */
  private penalise(x: number, y: number): void {
    if (this.finished || this.interval > 0 || this.countdown.running) return;
    this.crashes++;
    this.stageTime += CRASH_PENALTY;
    this.pops.add(x, y - 40, `+${CRASH_PENALTY}.00`, '#e8836a');
  }

  private finishStage(): void {
    this.times.push(this.stageTime);
    sfx.beep(true);
    this.interval = INTERVAL;
    const isLast = this.stageIndex >= STAGE_COUNT - 1;
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
      `全${STAGE_COUNT}ステージ 完走\n\n合計 ${formatTime(total)}\n`
      + (this.crashes > 0 ? `（自爆 ${this.crashes} 回 ＝ +${formatTime(this.crashes * CRASH_PENALTY)}）\n` : '（自爆なし）\n')
      + (isBest ? '★ ハイスコア更新 ★' : `ハイスコア ${formatTime(this.best!)}`)
      + '\n\nEnter / ○A でもう一度　　Esc / ×B でタイトルへ',
    );
    // 飛びながら終わるので、指を離すまでパッドを受け付けない
    this.padMenu.disarm();
    this.centerText.setColor(isBest ? '#ffd76b' : '#f4e6c8');
    this.centerText.setVisible(true);
  }

  private toTitle(): void {
    sfx.duck(false);
    sfx.stopEngines();
    this.scene.start('Title');
  }

  // ---------------------------------------------------------------- 一時停止

  /** ＋（Start）や Esc で止める。中身は対戦と同じ（`src/ui/PauseMenu.ts`） */
  private openPause(): void {
    if (this.pause.open) return;
    this.pause.show();
    this.padMenu.disarm();
    this.menuHeld = false;
    sfx.setEngine(0, 1, false);
    sfx.duck(true);
    sfx.menuDecide();
  }

  /** 止めるのをやめて戻る。握り直す間を置くため、GO! を短く出してから動かす */
  private resumeGame(): void {
    if (!this.pause.open) return;
    this.pause.hide();
    this.padMenu.disarm();
    sfx.duck(false);
    sfx.menuBack();
    this.countdown.beginResume();
  }

  private movePause(d: -1 | 1): void {
    if (!this.pause.open) return;
    this.pause.move(d);
    sfx.menuMove();
  }

  private choosePause(): void {
    if (this.pause.choice === 'quit') this.toTitle();
    else this.resumeGame();
  }

  /** 止めている間の操作 */
  private readPauseInput(): void {
    const s = this.padState;
    if (Math.abs(s.pitch) > 0.5) {
      if (!this.menuHeld) {
        this.menuHeld = true;
        this.movePause(s.pitch > 0 ? -1 : 1);
      }
    } else {
      this.menuHeld = false;
    }
    const m = this.padMenu.read(s);
    if (m.start || m.cancel) { this.resumeGame(); return; }
    if (m.decide) this.choosePause();
  }

  /**
   * パッドでの決定・取り消し・中断。
   *
   * 練習中は Start で一時停止、Select でやり直し。この2つは武器と重ならないので、
   * 飛びながら押しても差し支えない。決定と取り消し（○A・×B）は
   * **全10ステージを終えたあとだけ**読む ―― 対戦の画面と同じ扱いにそろえてある
   *
   * @returns 画面を切り替えたか
   */
  private readPadMenu(): boolean {
    const m = this.padMenu.read(this.padState);
    if (m.start) {
      // 終えたあとは画面に戻り方が出ているので、そのままタイトルへ。
      // 飛んでいる最中は、いったん止めて聞き直す
      if (this.finished) { this.toTitle(); return true; }
      this.openPause();
      return true;
    }
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
    this.crashes = 0;
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
    // 止めている間は何も進めない。読むのは一時停止の画面の操作だけ
    if (this.pause.open) { this.readPauseInput(); return; }
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
        if (this.rings.check(this.plane.prevX, this.plane.prevY, this.plane.x, this.plane.y)) {
          sfx.pop();
          this.particles.popBalloon(this.plane.x, this.plane.y);
          if (this.rings.cleared) this.finishStage();
        }
      }
    }

    this.particles.update(dt);
    this.pops.update(dt);
    this.rings.draw(this.t);
    this.drawHud(dt);
  }

  /** 機体を飛ばす。合図の間は出撃位置で待たせる（対戦と同じ） */
  private flyPlane(dt: number, live: boolean): void {
    // 一時停止から戻るときの合図では動かさない。その場で待たせる
    if (!live && !this.countdown.pinning) return;
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
      return;
    }
    // 練習では矢印キーも 1P の操作に使える。相手がいないので取り合いにならない
    const k = this.keys;
    const up = k.up.isDown || k.upAlt.isDown;
    const down = k.down.isDown || k.downAlt.isDown;
    // 上下は既定で操縦桿と同じ向き ―― 引く（下）と機首が上がる。オプション画面で逆にもできる
    const sign = settings.pullToClimb[0] ? 1 : -1;
    const byKey = ((down ? 1 : 0) - (up ? 1 : 0)) * sign;
    const stick = -this.padState.pitch * sign;
    const pitch = Math.abs(stick) > Math.abs(byKey) ? stick : byKey;
    this.plane.setThrottle(k.throttle.isDown || this.padState.throttle ? 1 : 0);
    // 輪をくぐったかは、機体が持っている「前のフレームの位置」との線分で見る。
    // 画面端で回り込んだフレームは機体側が前の位置を置き直すので、
    // 通っていない輪を横切ったことにはならない
    this.plane.update(pitch, dt);
    if (this.padState.rollEdge !== 0) this.plane.roll(this.padState.rollEdge);
    if (this.plane.y >= groundAt(this.plane.x)) {
      const y = groundAt(this.plane.x);
      this.particles.explode(this.plane.x, y, true);
      sfx.explosion();
      this.plane.destroy();
      this.penalise(this.plane.x, y);
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
      sfx.duck(false);
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
    this.keys.restart.on('down', () => {
      if (this.pause.open) { this.choosePause(); return; }
      if (this.finished) this.restart();
    });
    this.keys.retry.on('down', () => { if (!this.pause.open && !this.finished) this.beginStage(); });
    // Esc も「その場でタイトルへ」をやめて、いったん止めて聞き直す（対戦と同じ）
    this.keys.title.on('down', () => {
      if (this.pause.open) this.resumeGame();
      else this.openPause();
    });
    // 一時停止の画面でだけ働く上下
    for (const key of ['up', 'upAlt']) this.keys[key].on('down', () => this.movePause(-1));
    for (const key of ['down', 'downAlt']) this.keys[key].on('down', () => this.movePause(1));
    this.keys.mute.on('down', () => sfx.toggleMute());
    this.keys.bgm.on('down', () => sfx.toggleBgm());
    // ステージ選択の曲を引きずらないよう、ここで対戦と同じ曲に入れ替える
    sfx.playBgm('battle');
    for (let i = 0; i < 5; i++) {
      this.keys[`f${i}`].on('down', () => {
        this.film?.setLevel(i);
        settings.film = i;
        saveSettings();
      });
    }
  }

  private wakeAudio(): void {
    sfx.resume();
    sfx.startEngines(1);
    sfx.setEngine(0, 2, false);
  }

  // ---------------------------------------------------------------- 表示

  private setupHud(): void {
    this.pops = new ScorePops(this);

    // 計器盤は対戦と同じ板。出すものだけ差し替える ――
    // 得点の代わりに合計タイム、体力の代わりにのこりの輪。水温計はそのまま要る
    // （全開の使いどころがタイムを決めるので、むしろ対戦より見る）
    this.panel = new Panel(this, 18, 14, 0xd59a34, '', 70, {
      leftLabel: 'TIME',
      rightLabel: 'RINGS',
      ammo: false,
      divided: false,
      barColors: RING_BAR,
    });

    this.hudText = this.add.text(18 + PANEL.w / 2, 14 + PANEL.h + 6, '', {
      fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f4e6c8',
      backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 8, y: 3 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(71);

    this.stageName = this.add.text(VIEW.width / 2, 30, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '24px', color: '#f4e6c8',
      stroke: '#241a12', strokeThickness: 5,
    }).setOrigin(0.5, 0).setDepth(71);

    this.centerText = this.add.text(VIEW.width / 2, VIEW.height / 2 - 40, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '38px', color: '#f4e6c8',
      align: 'center', stroke: '#241a12', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(74).setVisible(false);

    this.add.text(VIEW.width / 2, VIEW.height - 26,
      '矢印の向きに輪をくぐる（順番どおりに）　　S/W・↓↑ 機首上げ下げ　　A/D・←→ ロール　　E 全開　　'
      + 'R / パッド Select やり直し　　Esc / パッド ＋ 一時停止', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f4e6c8',
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setDepth(71).setAlpha(0.9);
  }

  private drawHud(dt: number): void {
    const total = this.times.reduce((a, b) => a + b, 0) + (this.finished ? 0 : this.stageTime);
    const ringsAll = STAGES[Math.min(this.stageIndex, STAGE_COUNT - 1)].rings.length;
    this.panel.update({
      digits: formatTime(total),
      // 窓の隅に、今どのステージかを小さく添える
      note: `${Math.min(this.stageIndex + 1, STAGE_COUNT)}/${STAGE_COUNT}`,
      bar: ringsAll > 0 ? this.rings.remaining / ringsAll : 0,
      cannonAmmo: 0,
      temp: this.plane.temp,
    }, dt);

    this.hudText.setText(
      `輪 のこり ${this.rings.remaining}`
      + (this.crashes > 0 ? `　　自爆 ${this.crashes} 回（+${formatTime(this.crashes * CRASH_PENALTY)}）` : '')
      + (this.best !== null ? `　　ハイスコア ${formatTime(this.best)}` : ''),
    );
  }

  /** 強さは必ずオプションの設定から取る（理由は PlayScene の同名の処理を参照） */
  private setupFilm(): void {
    this.film = attachFilm(this);
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
