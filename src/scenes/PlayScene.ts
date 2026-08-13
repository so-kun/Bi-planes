/**
 * 空戦の画面。対戦とフリープレイの両方をここで受け持つ。
 *
 * 二機が同じ空を飛び、撃ち落として得点を競う。規定点数に達した側が勝ち。
 * 気球は共通の的で、撃った側の得点になる。金色の気球を撃つと自機が直る。
 *
 * **フリープレイ**（`init` に `free: true`）では相手を出さず、一人で飛ぶだけ。
 * 勝ち負けは付かず、気球を撃った数だけ数える。中の作りは同じで、
 * 機体が1機になるだけ ―― ここは players を舐めて回る書き方でそろえてある
 */

import Phaser from 'phaser';
import {
  BALLOON, ENGINE, FILM_DEFAULT, FLIGHT, PLANE, SCORE, SMOKE, VIEW,
} from '../config';
import { sfx } from '../audio';
import { FilmPipeline } from '../fx/FilmPipeline';
import { attachFilm } from '../fx/attachFilm';
import { Particles } from '../fx/Particles';
import { Plane, type Facing } from '../objects/Plane';
import { Balloons } from '../objects/Balloons';
import { Bullets } from '../objects/Bullets';
import { PadMenu } from '../input/PadMenu';
import { StuckKeyGuard } from '../input/StuckKeyGuard';
import { PadInput, PAD_IDLE, type PadState } from '../input/PadInput';
import { Pilot, AI_LEVELS } from '../ai/Pilot';
import { Countdown } from '../ui/Countdown';
import { Panel, PANEL } from '../ui/Panel';
import { rendererLine } from '../diagnostics';

const KEY = Phaser.Input.Keyboard.KeyCodes;

type Key = Phaser.Input.Keyboard.Key;

/** 1人分の操作キー */
interface PlayerKeys {
  up: Key; down: Key; rollL: Key; rollR: Key;
  throttle: Key; mg: Key; cannon: Key;
}

/** 1人分の持ち物。機体・入力・得点・タイマー類 */
interface Player {
  id: number;
  name: string;
  /** HUD と煙の見分けに使う色 */
  color: number;
  plane: Plane;
  keys: PlayerKeys;
  pad: PadInput;
  padState: PadState;
  /** パッドでの決定・取り消し・中断。武器と同じボタンなので受け付けを絞る */
  padMenu: PadMenu;
  score: number;
  respawnTimer: number;
  smokeTimer: { engine: number; handling: number };
  stallSoundTimer: number;
  lastEngineState: string;
  /** 出撃位置 */
  home: { x: number; y: number; facing: Facing };
  /** コンピュータ操縦。0 = 人が操縦、1..3 = 弱・普通・強 */
  ai: number;
  pilot: Pilot;
}

export class PlayScene extends Phaser.Scene {
  private players: Player[] = [];
  private particles!: Particles;
  private balloons!: Balloons;
  private bullets!: Bullets;
  private film: FilmPipeline | null = null;

  /** 全キー。押しっぱなしの見張りに渡す */
  private keys!: Record<string, Key>;
  private keyGuard!: StuckKeyGuard;
  /** パッドを認識したときに一度だけ音を起こす */
  private padWoke = false;
  private bgmOn = false;
  /** フィルム処理が外れていないか見張る間隔 */
  private filmWatchdog = 1;
  /** 勝った側。決まるまで null */
  private winner: Player | null = null;
  /** タイトルで選んだ操縦。0 = 人、1..3 = コンピュータの腕前 */
  private startAi: number[] = [0, 0];
  /**
   * フリープレイ。相手を出さず、一人で飛ぶだけ。
   * 勝ち負けは付かず、気球を撃った数だけ数える
   */
  private free = false;
  /** 開始の合図。この間は操作を受け付けず、機体は出撃位置で待つ */
  private countdown!: Countdown;

  /** 計器盤。1人につき1枚（src/ui/Panel.ts） */
  private panels: Panel[] = [];
  private debugText!: Phaser.GameObjects.Text;
  /** 操縦がどちらかを切り替えたときだけ出す表示 */
  private aiText!: Phaser.GameObjects.Text;
  private downedTexts: Phaser.GameObjects.Text[] = [];
  private aiBadges: Phaser.GameObjects.Text[] = [];
  private resultText!: Phaser.GameObjects.Text;
  private showDebug = false;

  constructor() {
    super('Play');
  }

  init(data: { p1Ai?: number; p2Ai?: number; free?: boolean }): void {
    this.startAi = [data?.p1Ai ?? 0, data?.p2Ai ?? 0];
    this.free = data?.free ?? false;
  }

  create(): void {
    const bg = this.add.image(0, 0, 'bg-sunset').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);
    bg.setDepth(0);

    // 描画の重ね順。火は煙より手前に出さないと爆発に見えない
    const below = this.add.container(0, 0).setDepth(10);
    const above = this.add.container(0, 0).setDepth(40);
    const fire = this.add.container(0, 0).setDepth(50);
    const balloonLayer = this.add.container(0, 0).setDepth(20);

    this.particles = new Particles(this, below, above, fire);
    this.balloons = new Balloons(this, balloonLayer);
    this.bullets = new Bullets(this, 60);

    this.setupInput();
    this.setupHud();
    this.setupFilm();

    // 最初は的が空にあったほうが試しやすい
    this.balloons.spawn(760, false);

    this.countdown = new Countdown(this);

    // タイトルで選んだ操縦を反映してから、開始の合図に入る
    this.players.forEach((p, i) => {
      for (let n = 0; n < this.startAi[i]; n++) this.cycleAi(p);
    });
    this.aiText.setAlpha(0);
    // ステージ選択の曲が鳴っていれば、ここで対戦の曲に入れ替わる。
    // まだ音を鳴らせない場合（この画面から直に始めたとき）は wakeAudio で鳴りだす
    this.startBgm();
    this.beginCountdown();
  }

  // ---------------------------------------------------------------- 開始の合図

  /**
   * 「READY?」から「GO!」まで。
   * この間は操作を受け付けず、機体は出撃位置で止まって待つ。
   * 飛ばしたまま待たせると、合図の前に落ちたり流されたりしてしまう
   */
  private beginCountdown(): void {
    this.countdown.begin();
    for (const p of this.players) {
      p.plane.reset(p.home.x, p.home.y, p.home.facing);
      p.lastEngineState = '';
      this.downedTexts[p.id].setVisible(false);
    }
  }

  /** @returns 合図が終わって試合が動いているか */
  private tickCountdown(): boolean {
    const live = this.countdown.tick();
    if (live) return true;
    // 機体は出撃位置に据え置く。合図の間に動きださないように
    for (const p of this.players) {
      p.plane.state.x = p.home.x;
      p.plane.state.y = p.home.y;
      p.plane.state.vx = p.home.facing * 260;
      p.plane.state.vy = 0;
      p.plane.container.setPosition(p.home.x, p.home.y);
    }
    return false;
  }

  // ---------------------------------------------------------------- 入力

  private setupInput(): void {
    const kb = this.input.keyboard!;
    // 1P は左手側、2P は矢印まわり。上下が機首、左右がロールで両者そろえてある
    this.keys = kb.addKeys({
      p1Up: KEY.W, p1Down: KEY.S, p1RollL: KEY.A, p1RollR: KEY.D,
      p1Throttle: KEY.E, p1Mg: KEY.F, p1Cannon: KEY.G,
      p2Up: KEY.UP, p2Down: KEY.DOWN, p2RollL: KEY.LEFT, p2RollR: KEY.RIGHT,
      p2Throttle: KEY.SHIFT, p2Mg: KEY.COMMA, p2Cannon: KEY.PERIOD,
      restart: KEY.ENTER, title: KEY.ESC, ai1: KEY.V, ai2: KEY.C,
      mute: KEY.M, bgm: KEY.B, debug: KEY.TAB,
      f0: KEY.ONE, f1: KEY.TWO, f2: KEY.THREE, f3: KEY.FOUR, f4: KEY.FIVE,
    }) as Record<string, Key>;

    const k = this.keys;
    this.players = [
      this.makePlayer(0, '1P', 0xa8402c,
        { side: 'plane-red', top: 'plane-red-top', under: 'plane-red-under' },
        { up: k.p1Up, down: k.p1Down, rollL: k.p1RollL, rollR: k.p1RollR,
          throttle: k.p1Throttle, mg: k.p1Mg, cannon: k.p1Cannon },
        { x: 230, y: 380, facing: 1 }),
    ];
    // フリープレイでは相手を出さない。以下はどこも players を舐めて回るので、
    // 1機でもそのまま動く
    if (!this.free) {
      this.players.push(this.makePlayer(1, '2P', 0x3c5a78,
        { side: 'plane-blue', top: 'plane-blue-top', under: 'plane-blue-under' },
        { up: k.p2Up, down: k.p2Down, rollL: k.p2RollL, rollR: k.p2RollR,
          throttle: k.p2Throttle, mg: k.p2Mg, cannon: k.p2Cannon },
        { x: VIEW.width - 230, y: 380, facing: -1 }));
    }

    // ブラウザは操作があるまで音を鳴らせない
    const wake = (): void => this.wakeAudio();
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    this.keyGuard = new StuckKeyGuard(this.keys);
    this.keyGuard.attach();

    // キーを押したまま別のタブやウィンドウへ移ると、キーを離したイベントが届かず、
    // 戻ってきたときに押しっぱなしの状態が残る。
    // 離脱と復帰の両方で押下状態を消す。ブラウザのイベントは環境によって
    // 飛んでこないことがあるので、Phaser 側の通知も併せて拾う
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
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('focus', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const ev of [core.BLUR, core.FOCUS, core.PAUSE, core.RESUME, core.HIDDEN, core.VISIBLE]) {
        this.game.events.off(ev, releaseAll);
      }
    });

    // ロールと 20mm は押した瞬間だけ。押しっぱなしで連続させない
    for (const p of this.players) {
      p.keys.rollL.on('down', () => { if (this.running) p.plane.roll(-1); });
      p.keys.rollR.on('down', () => { if (this.running) p.plane.roll(1); });
      p.keys.cannon.on('down', () => { if (this.running) this.fireCannon(p); });
    }

    k.restart.on('down', () => { if (this.winner) this.restart(); });
    k.title.on('down', () => this.toTitle());
    k.ai1.on('down', () => this.cycleAi(this.players[0]));
    k.ai2.on('down', () => { if (this.players[1]) this.cycleAi(this.players[1]); });
    k.mute.on('down', () => sfx.toggleMute());
    k.bgm.on('down', () => { this.bgmOn = sfx.toggleBgm(); });
    k.debug.on('down', () => {
      this.showDebug = !this.showDebug;
      this.debugText.setVisible(this.showDebug);
    });
    for (let i = 0; i < 5; i++) {
      k[`f${i}`].on('down', () => this.film?.setLevel(i));
    }
  }

  private makePlayer(
    id: number, name: string, color: number,
    art: { side: string; top: string; under: string },
    keys: PlayerKeys,
    home: { x: number; y: number; facing: Facing },
  ): Player {
    const plane = new Plane(this, art, home.x, home.y, home.facing);
    plane.container.setDepth(30);
    return {
      id, name, color, plane, keys,
      pad: new PadInput(id),
      padState: PAD_IDLE,
      padMenu: new PadMenu(),
      score: 0,
      respawnTimer: 0,
      smokeTimer: { engine: 0, handling: 0 },
      stallSoundTimer: 0,
      lastEngineState: '',
      home,
      ai: 0,
      pilot: new Pilot(AI_LEVELS[1]),
    };
  }

  /**
   * コンピュータ操縦の切り替え。切 → 弱 → 普通 → 強 → 切 と回る。
   * 2P を任せれば1人で遊べる。フリープレイで 1P を任せれば、一機が飛ぶ様子を眺められる
   */
  private cycleAi(p: Player): void {
    p.ai = (p.ai + 1) % (AI_LEVELS.length + 1);
    if (p.ai > 0) p.pilot.setLevel(AI_LEVELS[p.ai - 1]);
    p.pilot.reset();
    this.flashAi();
  }

  private flashAi(): void {
    const label = this.players
      .map((p) => `${p.name} ${p.ai === 0 ? '人' : `CPU ${AI_LEVELS[p.ai - 1].name}`}`)
      .join('　　');
    this.aiText.setText(label);
    this.aiText.setAlpha(1);
    for (const p of this.players) {
      this.aiBadges[p.id].setText(p.ai === 0 ? '' : `CPU 操縦  ${AI_LEVELS[p.ai - 1].name}`);
      this.aiBadges[p.id].setVisible(p.ai > 0);
    }
  }

  /** 試合中か。勝敗が決まったら操作を受け付けない */
  private get running(): boolean { return this.winner === null; }

  private wakeAudio(): void {
    sfx.resume();
    sfx.startEngines(this.players.length);
    this.startBgm();
  }

  /** 対戦の曲へ。B キーで切ってあれば鳴らない（playBgm は同じ曲なら何もしない） */
  private startBgm(): void {
    sfx.playBgm('battle');
    this.bgmOn = sfx.bgmPlaying;
  }

  // ---------------------------------------------------------------- 進行

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.keyGuard.update();
    this.watchFilm(dt);

    for (const p of this.players) {
      // 撃墜されている間も読む。読まずにいると立ち上がりの記録が古びて、
      // 再出撃した瞬間に押しっぱなしのボタンが暴発する
      p.padState = p.pad.read();
    }
    // パッドしか触らない人にも音を出す。ただしブラウザによっては
    // パッドの操作を「音を鳴らしてよい合図」と認めないので、
    // そのときはキーを1つ押すかクリックしてもらう必要がある
    if (!this.padWoke && this.players.some((p) => p.padState.connected)) {
      this.padWoke = true;
      this.wakeAudio();
    }
    if (this.readPadMenu()) return;

    const live = this.tickCountdown();
    if (this.running && live) {
      for (const p of this.players) this.updatePlayer(p, dt);
    }

    this.bullets.update(dt);
    this.balloons.update(dt);
    this.particles.update(dt);
    this.checkHits();
    this.bullets.draw();
    this.drawHud(dt);
    if (this.aiText.alpha > 0) this.aiText.setAlpha(Math.max(0, this.aiText.alpha - dt * 0.5));
  }

  private updatePlayer(p: Player, dt: number): void {
    if (!p.plane.alive) {
      p.respawnTimer -= dt;
      p.plane.setThrottle(0);
      this.downedTexts[p.id].setVisible(true);
      this.downedTexts[p.id].setText(`${p.name} 撃墜\n再出撃まで ${Math.max(0, p.respawnTimer).toFixed(1)}`);
      if (p.respawnTimer <= 0) {
        p.plane.reset(p.home.x, p.home.y, p.home.facing);
        p.lastEngineState = '';
        this.downedTexts[p.id].setVisible(false);
      }
      return;
    }

    // コンピュータに任せているときは人の操作を見ない。
    // AI が出すのは人と同じ5つ（機首・ロール・スロットル・7.7mm・20mm）だけなので、
    // ここから先の扱いは人が操縦しているときと変わらない
    let pitch: number;
    let throttle: boolean;
    let rollEdge: -1 | 0 | 1;
    let mg: boolean;
    let cannonEdge: boolean;

    if (p.ai > 0) {
      const foe = this.other(p);
      const intent = p.pilot.think(p.plane, foe?.plane.alive ? foe.plane : null, this.balloons.list, dt);
      ({ pitch, throttle, rollEdge, mg, cannonEdge } = intent);
    } else {
      // キーボードは倒し切りの3値、パッドは倒した量がそのまま出る。
      // 両方触っている場合は、深く入れているほうを採る。
      //
      // 上下は操縦桿と同じ向き ―― **引く（下）と機首が上がる**（2026-08-13 変更）。
      // ここで反転させるのは人の操作だけ。AI が出す pitch は機体基準のままなので触らない
      const byKey = (p.keys.down.isDown ? 1 : 0) - (p.keys.up.isDown ? 1 : 0);
      const stick = -p.padState.pitch;
      pitch = Math.abs(stick) > Math.abs(byKey) ? stick : byKey;
      throttle = p.keys.throttle.isDown || p.padState.throttle;
      rollEdge = p.padState.rollEdge;
      mg = p.keys.mg.isDown || p.padState.mg;
      cannonEdge = p.padState.cannonEdge;
    }

    // スロットルは押している間だけ全開。離せば巡航に戻る
    p.plane.setThrottle(throttle ? 1 : 0);
    p.plane.update(pitch, dt);
    if (p.plane.overheated) this.overheat(p);
    this.syncEngineSound(p);

    if (rollEdge !== 0) p.plane.roll(rollEdge);
    if (cannonEdge) this.fireCannon(p);
    if (mg) this.fireMg(p);

    // 地面への激突は自滅。相手に点が入る
    if (p.plane.y >= VIEW.groundY) this.crash(p);

    this.emitSmoke(p, dt);
    this.warnStall(p, dt);
  }

  // ---------------------------------------------------------------- 射撃と撃墜

  private fireMg(p: Player): void {
    if (!p.plane.canFireMg()) return;
    const m = p.plane.muzzle();
    this.bullets.fire('mg', m.x, m.y, m.ux, m.uy, p.id);
    p.plane.noteMgFired();
    sfx.mg();
  }

  private fireCannon(p: Player): void {
    if (!p.plane.canFireCannon()) return;
    const m = p.plane.muzzle();
    this.bullets.fire('cannon', m.x, m.y, m.ux, m.uy, p.id);
    p.plane.noteCannonFired();
    this.particles.muzzleSmoke(m.x, m.y);
    sfx.cannon();
  }

  /**
   * 水温が振り切れたまま吹かし続けた。エンジンが焼き付いて、
   * 弾を受けたのと同じだけ傷む ―― 吹かしっぱなしの代償はここで払わせる。
   * 撃たれたわけではないので、落ちても相手に点は入らない
   */
  private overheat(p: Player): void {
    p.plane.takeDamage(ENGINE.overheatDamage, 'engine');
    // 黒い煙をひと吹き。何が起きたかを音と絵の両方で分かるようにする
    const e = p.plane.enginePos();
    for (let i = 0; i < 3; i++) this.particles.damage(e.x, e.y, 'engine');
    sfx.hit();
    if (p.plane.hp <= 0) {
      this.particles.explode(p.plane.x, p.plane.y, false);
      sfx.explosion();
      this.downPlane(p, null, 0);
    }
  }

  /** 地面への激突。撃たれたわけではないので、相手には自滅ぶんの点が入る */
  private crash(p: Player): void {
    this.particles.explode(p.plane.x, VIEW.groundY, true);
    sfx.explosion();
    this.downPlane(p, this.other(p), SCORE.suicide);
  }

  /** 撃墜された側の後始末と、仕留めた側への加点 */
  private downPlane(p: Player, credit: Player | null, points: number): void {
    p.plane.destroy();
    p.respawnTimer = PLANE.respawnDelay;
    // 落ちた機のエンジン音は絞る。鳴ったままだと空にいない機の音が残る
    sfx.setEngine(p.id, 1, false);
    p.lastEngineState = '';
    if (credit) this.addScore(credit, points);
  }

  /** 相手。フリープレイでは相手がいないので null を返す */
  private other(p: Player): Player | null {
    return this.players[p.id === 0 ? 1 : 0] ?? null;
  }

  private addScore(p: Player, points: number): void {
    if (!this.running) return;
    p.score += points;
    // フリープレイは数えるだけ。終わりはない
    if (!this.free && p.score >= SCORE.winning) this.finish(p);
  }

  private finish(p: Player): void {
    this.winner = p;
    // 撃ち合いの最中に決着が出る。引き金を引いたままの一発で
    // 「もう一度」が始まらないよう、指を離すまで受け付けない
    this.disarmPads();
    for (const q of this.players) {
      q.plane.setThrottle(0);
      this.downedTexts[q.id].setVisible(false);
    }
    for (const q of this.players) sfx.setEngine(q.id, 1, false);
    this.resultText.setText(
      `${p.name} の勝ち\n\n${this.players[0].score} 対 ${this.players[1].score}\n`
      + 'Enter / ○A でもう一度　　Esc / ×B でタイトルへ');
    this.resultText.setColor(p.id === 0 ? '#e8836a' : '#8fb6d8');
    this.resultText.setVisible(true);
  }

  private toTitle(): void {
    sfx.stopEngines();
    this.scene.start('Title');
  }

  /**
   * パッドでの決定・取り消し・中断。
   *
   * **決着が付いてからでないと決定と取り消しは読まない** ―― 飛んでいる間、
   * この2つは 20mm と 7.7mm だからで、読むと撃つたびに画面が変わってしまう。
   * 飛行中の中断は Start に分けてある。武器と重ならないので、いつ押しても安全。
   *
   * どちらのパッドで押しても効く。1人で遊んでいて 2P 側のパッドしか
   * つないでいない、といった場合に手が止まらないように
   *
   * @returns 画面を切り替えたか。切り替えたなら、このフレームの残りはやらない
   */
  private disarmPads(): void {
    for (const p of this.players) p.padMenu.disarm();
  }

  private readPadMenu(): boolean {
    for (const p of this.players) {
      const m = p.padMenu.read(p.padState);
      if (m.start) { this.toTitle(); return true; }
      if (this.running) continue;
      if (m.decide) { this.restart(); return true; }
      if (m.cancel) { this.toTitle(); return true; }
    }
    return false;
  }

  private restart(): void {
    this.winner = null;
    this.resultText.setVisible(false);
    this.disarmPads();
    for (const p of this.players) {
      p.score = 0;
      p.respawnTimer = 0;
      p.pilot.reset();
    }
    for (const b of [...this.balloons.list]) this.balloons.pop(b);
    this.bullets.list.length = 0;
    // やり直しにも開始の合図を入れる。いきなり始まると身構える間がない
    this.beginCountdown();
  }

  /**
   * 当たり判定。弾は自機以外の機体と気球に当たる。
   *
   * 機体に当たったときは、当たりどころで壊れる場所が決まる（2026-08-12 決定）:
   * 機首側ならエンジン、尾翼側なら舵。狙って壊し分けられるようにするため
   */
  private checkHits(): void {
    for (const b of [...this.bullets.list]) {
      let consumed = false;

      for (const p of this.players) {
        // 再出撃直後は弾がすり抜ける。出てきたところを撃たれて何もできないのを防ぐ
        if (p.id === b.owner || !p.plane.alive || p.plane.invulnerable) continue;
        const dx = b.x - p.plane.x;
        const dy = b.y - p.plane.y;
        if (dx * dx + dy * dy > PLANE.hitRadius * PLANE.hitRadius) continue;

        // 機体の前後どちらに当たったか。機軸に沿って射影する
        const along = dx * Math.cos(p.plane.state.pitch) + dy * Math.sin(p.plane.state.pitch);
        p.plane.takeDamage(b.damage, along >= 0 ? 'engine' : 'handling');
        this.bullets.remove(b);
        consumed = true;
        sfx.hit();

        if (p.plane.hp <= 0) {
          this.particles.explode(p.plane.x, p.plane.y, false);
          sfx.explosion();
          this.downPlane(p, this.players[b.owner] ?? null, SCORE.kill);
        }
        break;
      }
      if (consumed) continue;

      for (const balloon of [...this.balloons.list]) {
        const hb = this.balloons.hitBox(balloon);
        if ((b.x - hb.x) ** 2 + (b.y - hb.y) ** 2 >= hb.r * hb.r) continue;
        this.bullets.remove(b);
        this.balloons.pop(balloon);
        this.particles.popBalloon(hb.x, hb.y);
        sfx.pop();
        const shooter = this.players[b.owner];
        if (shooter) {
          if (balloon.gold) this.repair(shooter);
          this.addScore(shooter, SCORE.balloon);
        }
        break;
      }
    }
  }

  /** 金色の気球の効果。傷んだ機体が直る */
  private repair(p: Player): void {
    const k = BALLOON.goldRepair;
    p.plane.hp = Math.min(PLANE.maxHp, p.plane.hp + PLANE.maxHp * k);
    p.plane.damage.engine = Math.min(1, p.plane.damage.engine + (1 - p.plane.damage.engine) * k);
    p.plane.damage.handling = Math.min(1, p.plane.damage.handling + (1 - p.plane.damage.handling) * k);
    p.smokeTimer.engine = 0;
    p.smokeTimer.handling = 0;
    p.lastEngineState = '';
  }

  // ---------------------------------------------------------------- 音と煙

  /** スロットル・損傷・水温が変わったときだけエンジン音を鳴らし直す */
  private syncEngineSound(p: Player): void {
    const damaged = p.plane.hp < 70;
    const strained = p.plane.overRedline;
    const key = `${p.plane.state.throttle}/${damaged}/${strained}`;
    if (key === p.lastEngineState) return;
    p.lastEngineState = key;
    // EngineVoice の段階は 1..3。巡航を 2、全開を 3 に対応させる
    sfx.setEngine(p.id, p.plane.state.throttle + 2, damaged, strained);
  }

  /**
   * 煙の発生。通常飛行では出さない。
   * 損傷したときだけ、どこをやられたかが色でわかるように出し分ける:
   *   エンジン損傷 → 黒煙 / 操作系（舵）損傷 → 白煙
   * 傷が深いほど間隔が詰まる。フレームが落ちている環境でも途切れないよう、
   * 1 フレームに複数出すことがある（上限つき）
   */
  private emitSmoke(p: Player, dt: number): void {
    const e = p.plane.enginePos();
    for (const part of ['engine', 'handling'] as const) {
      const hurt = p.plane.hurt(part);
      if (hurt < SMOKE.damageThreshold) {
        p.smokeTimer[part] = 0;
        continue;
      }
      const interval = SMOKE.damageInterval / hurt;
      p.smokeTimer[part] += dt;
      let guard = 4;
      while (p.smokeTimer[part] >= interval && guard-- > 0) {
        p.smokeTimer[part] -= interval;
        this.particles.damage(e.x, e.y, part);
      }
      if (p.smokeTimer[part] > interval) p.smokeTimer[part] = 0;
    }
  }

  private warnStall(p: Player, dt: number): void {
    p.stallSoundTimer = Math.max(0, p.stallSoundTimer - dt);
    const r = p.plane.readout;
    if (r.stalled && r.speed < FLIGHT.stallWarnSpeed && p.stallSoundTimer <= 0) {
      sfx.stall();
      p.stallSoundTimer = 2.2;
    }
  }

  // ---------------------------------------------------------------- 見た目

  private setupFilm(): void {
    this.film = attachFilm(this, this.film?.getLevel() ?? FILM_DEFAULT);
  }

  /**
   * フィルム処理が外れていないか、ときどき見張る。
   * WebGL の描画コンテキストが失われて復帰したときなどに、
   * カメラからポストパイプラインが外れたままになることがある。
   * そうなると絵はそのまま出るのにフィルムの質感だけが消え、
   * 「膜が剥がれた」ように見えてしまう
   */
  private watchFilm(dt: number): void {
    if (!(this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    this.filmWatchdog -= dt;
    if (this.filmWatchdog > 0) return;
    this.filmWatchdog = 1;
    if (this.cameras.main.getPostPipeline(FilmPipeline)) return;
    this.setupFilm();          // 強さは掛け直しても引き継がれる
  }

  private setupHud(): void {
    const margin = 18;
    for (const p of this.players) {
      // 1P は左端、2P は右端。中身の並びは左右で同じにする ――
      // 鏡にすると銘板の文字まで裏返って読みにくい
      this.panels[p.id] = new Panel(
        this, p.id === 0 ? margin : VIEW.width - margin - PANEL.w, 14, p.color, p.name,
      );
      // 誰が操縦しているかは試合中ずっと分かっている必要があるので、計器の下に出しておく
      this.aiBadges[p.id] = this.add.text(
        p.id === 0 ? margin + 4 : VIEW.width - margin - 4, 14 + PANEL.h + 6, '', {
          fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f4e6c8',
          backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 7, y: 3 },
        }).setOrigin(p.id === 0 ? 0 : 1, 0).setDepth(71).setVisible(false);
      this.downedTexts[p.id] = this.add.text(
        p.id === 0 ? VIEW.width * 0.27 : VIEW.width * 0.73, VIEW.height / 2 - 30, '', {
          fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '28px', color: '#f4e6c8',
          align: 'center', stroke: '#241a12', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(72).setVisible(false);
    }

    // 操作の説明は地面の絵の上に出るので、そのままでは読めない。敷き紙を1枚挟む
    this.add.text(VIEW.width / 2, VIEW.height - 21,
      '1P  S/W 機首上げ下げ  A/D ロール  E 全開  F 7.7mm  G 20mm　　'
      + (this.free ? '' : '2P  ↓/↑ 機首上げ下げ  ←/→ ロール  Shift 全開  , 7.7mm  . 20mm　　')
      + `V${this.free ? '' : '/C'} CPU 操縦${this.free ? '' : '（1P/2P）'}`
      + '  Esc / パッド Start タイトル  1-5 フィルム  B BGM  M 消音  Tab 計器', {
        fontFamily: 'Georgia, serif', fontSize: '14px', color: '#f4e6c8',
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 5 },
      }).setOrigin(0.5).setDepth(71).setAlpha(0.9);

    this.resultText = this.add.text(VIEW.width / 2, VIEW.height / 2 - 40, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '44px', color: '#f4e6c8',
      align: 'center', stroke: '#241a12', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(73).setVisible(false);

    // 切り替えたときだけ出て、しばらくすると消える。常時出ていると邪魔になる
    this.aiText = this.add.text(VIEW.width / 2, 128, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '26px', color: '#f4e6c8',
      align: 'center', stroke: '#241a12', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(72).setAlpha(0);

    this.debugText = this.add.text(24, 128, '', {
      fontFamily: 'ui-monospace, monospace', fontSize: '13px', color: '#f4e6c8',
      backgroundColor: 'rgba(24,16,10,0.45)', padding: { x: 8, y: 6 },
    }).setDepth(71).setVisible(this.showDebug);
  }

  private drawHud(dt: number): void {
    for (const p of this.players) {
      this.panels[p.id].update({
        score: p.score,
        // フリープレイは勝ち負けが無いので、上限を出さない
        target: this.free ? null : SCORE.winning,
        hp: p.plane.hp,
        cannonAmmo: p.plane.cannonAmmo,
        temp: p.plane.temp,
      }, dt);
    }
    if (!this.showDebug) return;
    this.debugText.setText([
      ...this.players.map((q) => this.debugLines(q)),
      `気球 ${this.balloons.list.length}/${BALLOON.maxAlive}（金 ${this.balloons.list.filter((b) => b.gold).length}）` +
        `  弾 ${this.bullets.list.length}` +
        `  フィルム ${['切', '弱', '既定', '標準', '強'][this.film?.getLevel() ?? 2]}${this.film ? '' : '（WebGL 無効）'}` +
        `  BGM ${this.bgmOn ? 'on' : 'off'}`,
      `キー ${this.keyGuard.heldNames().join(' ') || '(なし)'}` +
        `${this.keyGuard.releasedCount ? `  ／ 押しっぱなしを解除 ${this.keyGuard.releasedCount}回` : ''}`,
      rendererLine(this.game),
    ].join('\n'));
  }

  private debugLines(p: Player): string {
    const r = p.plane.readout;
    return [
      `${p.name}[${p.ai === 0 ? '人' : `CPU ${AI_LEVELS[p.ai - 1].name}`}] 得点 ${p.score}` +
        `  速度 ${r.speed.toFixed(0)}${r.stalled ? ' ★失速★' : ''}` +
        `  迎え角 ${(r.aoa * 180 / Math.PI).toFixed(1)}°  ${p.plane.inverted ? '背面' : '正立'}` +
        `${p.plane.rolling ? '(ロール中)' : ''}`,
      `   HP ${p.plane.hp}  エンジン${(p.plane.damage.engine * 100).toFixed(0)}%（黒煙）` +
        ` 舵${(p.plane.damage.handling * 100).toFixed(0)}%（白煙）  20mm ${p.plane.cannonAmmo}発`,
      `   パッド ${this.padLabel(p)}`,
    ].join('\n');
  }

  /**
   * パッドの状態。つないでも出てこないときに、原因が切り分けられるようにする。
   * ブラウザはボタンが一度押されるまでパッドを見せてくれない決まりなので、
   * 「つないだのに出ない」は正常なこともある
   */
  private padLabel(p: Player): string {
    const s = p.padState;
    if (s.unsupported) return `${s.id.slice(0, 30)}（標準配列でないため使いません）`;
    if (!s.connected) return '未接続（ボタンを一度押すと認識されます）';
    return `${s.id.slice(0, 26)}  傾き ${s.pitch.toFixed(2)}`;
  }
}
