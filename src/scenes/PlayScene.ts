/**
 * M1: 1P プレイテスト版。
 * 目的は操作感と効果音の確認なので、対戦相手はまだ出さず、気球と空だけ。
 */

import Phaser from 'phaser';
import { BALLOON, FLIGHT, PLANE, SCORE, SMOKE, THROTTLE_NAMES, VIEW, WEAPON } from '../config';
import { Sfx } from '../audio';
import { FilmPipeline } from '../fx/FilmPipeline';
import { Particles } from '../fx/Particles';
import { Plane } from '../objects/Plane';
import { Balloons } from '../objects/Balloons';
import { Bullets } from '../objects/Bullets';

const KEY = Phaser.Input.Keyboard.KeyCodes;

export class PlayScene extends Phaser.Scene {
  private plane!: Plane;
  private particles!: Particles;
  private balloons!: Balloons;
  private bullets!: Bullets;
  private sfx = new Sfx();
  private film: FilmPipeline | null = null;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private score = 0;
  private respawnTimer = 0;
  private trailTimer = 0;
  private damageTimer = 0;
  private stallSoundTimer = 0;
  private bgmOn = false;
  /** エンジン音を鳴らし直す判定用。段階が変わったときだけ更新する */
  private lastEngineState = '';

  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private showDebug = true;

  constructor() {
    super('Play');
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

    this.plane = new Plane(this, {
      side: 'plane-red', top: 'plane-red-top', under: 'plane-red-under',
    }, 220, 380, 1);
    this.plane.container.setDepth(30);

    this.setupInput();
    this.setupHud();
    this.setupFilm();

    // 最初は的が空にあったほうが試しやすい
    this.balloons.spawn(760);
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys({
      up: KEY.W, down: KEY.S, upAlt: KEY.UP, downAlt: KEY.DOWN,
      rollL: KEY.A, rollR: KEY.D, rollLAlt: KEY.LEFT, rollRAlt: KEY.RIGHT,
      throttle: KEY.E, mg: KEY.F, cannon: KEY.G,
      mute: KEY.M, bgm: KEY.B, debug: KEY.TAB,
      f0: KEY.ONE, f1: KEY.TWO, f2: KEY.THREE, f3: KEY.FOUR, f4: KEY.FIVE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // ブラウザは操作があるまで音を鳴らせない
    const wake = (): void => {
      this.sfx.resume();
      this.sfx.startEngine();
    };
    kb.on('keydown', wake);
    this.input.on('pointerdown', wake);

    // ロールは左右で回る向きが変わる。どちらも 180度 回って正立と背面が入れ替わる
    for (const k of ['rollL', 'rollLAlt']) this.keys[k].on('down', () => { this.plane.roll(-1); });
    for (const k of ['rollR', 'rollRAlt']) this.keys[k].on('down', () => { this.plane.roll(1); });
    this.keys.cannon.on('down', () => this.fireCannon());
    this.keys.mute.on('down', () => this.sfx.toggleMute());
    this.keys.bgm.on('down', () => { this.bgmOn = this.sfx.toggleBgm(); });
    this.keys.debug.on('down', () => {
      this.showDebug = !this.showDebug;
      this.debugText.setVisible(this.showDebug);
    });
    for (let i = 0; i < 5; i++) {
      this.keys[`f${i}`].on('down', () => this.film?.setLevel(i));
    }
  }

  private setupFilm(): void {
    const renderer = this.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;  // Canvas では効かない
    renderer.pipelines.addPostPipeline('Film', FilmPipeline);
    this.cameras.main.setPostPipeline(FilmPipeline);
    this.film = this.cameras.main.getPostPipeline(FilmPipeline) as FilmPipeline;
  }

  private setupHud(): void {
    this.hud = this.add.graphics().setDepth(70);
    this.hudText = this.add.text(0, 0, '', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '24px', color: '#241a12',
    }).setDepth(71);
    this.add.text(20, VIEW.height - 34,
      'W/S 機首  A/D ロール  E 全開（押している間）  F 7.7mm  G 20mm   ｜  1-5 フィルム  B BGM  M 消音  Tab 計器', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: '#f4e6c8',
      }).setDepth(71).setAlpha(0.75);
    this.debugText = this.add.text(24, 122, '', {
      fontFamily: 'ui-monospace, monospace', fontSize: '14px', color: '#f4e6c8',
      backgroundColor: 'rgba(24,16,10,0.45)', padding: { x: 8, y: 6 },
    }).setDepth(71);
  }

  private fireMg(): void {
    if (!this.plane.canFireMg()) return;
    const m = this.plane.muzzle();
    this.bullets.fire('mg', m.x, m.y, m.ux, m.uy, 0);
    this.plane.noteMgFired();
    this.sfx.mg();
  }

  private fireCannon(): void {
    if (!this.plane.canFireCannon()) return;
    const m = this.plane.muzzle();
    this.bullets.fire('cannon', m.x, m.y, m.ux, m.uy, 0);
    this.plane.noteCannonFired();
    this.particles.muzzleSmoke(m.x, m.y);
    this.sfx.cannon();
  }

  private crash(): void {
    this.particles.explode(this.plane.x, VIEW.groundY, true);
    this.sfx.explosion();
    this.plane.destroy();
    this.respawnTimer = PLANE.respawnDelay;
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.film?.advance(dt);

    if (this.plane.alive) {
      const up = this.keys.up.isDown || this.keys.upAlt.isDown;
      const down = this.keys.down.isDown || this.keys.downAlt.isDown;
      // スロットルは押している間だけ全開。離せば巡航に戻る
      this.plane.setThrottle(this.keys.throttle.isDown ? 1 : 0);
      this.plane.update((up ? 1 : 0) - (down ? 1 : 0), dt);
      this.syncEngineSound();

      if (this.keys.mg.isDown) this.fireMg();

      // 地面への激突
      if (this.plane.y >= VIEW.groundY) this.crash();

      this.emitSmoke(dt);
      this.warnStall(dt);
    } else {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.plane.reset(Phaser.Math.Between(200, VIEW.width - 200), 300, 1);
        this.lastEngineState = '';
      }
    }

    this.bullets.update(dt);
    this.balloons.update(dt);
    this.particles.update(dt);
    this.checkHits();
    this.bullets.draw();
    this.drawHud();
  }

  /** スロットルや損傷が変わったときだけエンジン音を鳴らし直す */
  private syncEngineSound(): void {
    const damaged = this.plane.hp < 70;
    const key = `${this.plane.state.throttle}/${damaged}`;
    if (key === this.lastEngineState) return;
    this.lastEngineState = key;
    // EngineVoice の段階は 1..3。巡航を 2、全開を 3 に対応させる
    this.sfx.setEngine(this.plane.state.throttle + 2, damaged);
  }

  /**
   * 煙の発生。フレームが落ちている環境でも軌跡が途切れないよう、
   * 1 フレームに複数出すことがある（上限つき）
   */
  private emitSmoke(dt: number): void {
    const e = this.plane.enginePos();
    this.trailTimer += dt;
    let guard = 6;
    while (this.trailTimer >= SMOKE.trailInterval && guard-- > 0) {
      this.trailTimer -= SMOKE.trailInterval;
      this.particles.trail(e.x, e.y);
    }
    if (this.trailTimer > SMOKE.trailInterval) this.trailTimer = 0;

    if (this.plane.hp < 70) {
      this.damageTimer += dt;
      guard = 4;
      while (this.damageTimer >= SMOKE.damageInterval && guard-- > 0) {
        this.damageTimer -= SMOKE.damageInterval;
        this.particles.damage(e.x, e.y);
      }
      if (this.damageTimer > SMOKE.damageInterval) this.damageTimer = 0;
    }
  }

  private warnStall(dt: number): void {
    this.stallSoundTimer = Math.max(0, this.stallSoundTimer - dt);
    const r = this.plane.readout;
    if (r.stalled && r.speed < FLIGHT.stallWarnSpeed && this.stallSoundTimer <= 0) {
      this.sfx.stall();
      this.stallSoundTimer = 2.2;
    }
  }

  private checkHits(): void {
    for (const b of [...this.bullets.list]) {
      for (const balloon of [...this.balloons.list]) {
        const hb = this.balloons.hitBox(balloon);
        if ((b.x - hb.x) ** 2 + (b.y - hb.y) ** 2 < hb.r * hb.r) {
          this.bullets.remove(b);
          this.balloons.pop(balloon);
          this.particles.popBalloon(hb.x, hb.y);
          this.sfx.pop();
          this.score += SCORE.balloon;
          break;
        }
      }
    }
  }

  private drawHud(): void {
    const g = this.hud;
    g.clear();
    g.fillStyle(0xf4e6c8, 1).lineStyle(5, 0x241a12, 1);
    g.fillRoundedRect(22, 20, 262, 84, 9);
    g.strokeRoundedRect(22, 20, 262, 84, 9);
    g.fillStyle(0xa8402c, 1);
    g.fillRoundedRect(22, 20, 68, 84, 9);
    g.strokeRoundedRect(22, 20, 68, 84, 9);

    // HP
    g.fillStyle(0xd3bd93, 1).lineStyle(3, 0x241a12, 1);
    g.fillRoundedRect(106, 64, 150, 13, 6.5);
    g.strokeRoundedRect(106, 64, 150, 13, 6.5);
    g.fillStyle(0xa8402c, 1);
    g.fillRoundedRect(109, 67, 144 * (this.plane.hp / PLANE.maxHp), 7, 3.5);

    // 20mm 残弾
    for (let i = 0; i < WEAPON.cannon.ammo; i++) {
      g.fillStyle(i < this.plane.cannonAmmo ? 0xd59a34 : 0xc4b087, 1);
      g.lineStyle(3, 0x241a12, 1);
      g.fillRoundedRect(106 + i * 14, 82, 9, 14, 3);
      g.strokeRoundedRect(106 + i * 14, 82, 9, 14, 3);
    }

    // スロットル計
    const th = this.plane.state.throttle;
    g.lineStyle(3, 0x241a12, 1);
    g.beginPath();
    g.arc(254, 94, 16, Math.PI, 0);
    g.strokePath();
    const a = Math.PI + (th + 0.5) / THROTTLE_NAMES.length * Math.PI;
    g.lineStyle(4, 0xa8402c, 1);
    g.lineBetween(254, 94, 254 + Math.cos(a) * 14, 94 + Math.sin(a) * 14);

    this.hudText.setPosition(38, 42);
    this.hudText.setText('P1');
    this.hudText.setColor('#f4e6c8');

    const r = this.plane.readout;
    if (this.showDebug) {
      this.debugText.setText([
        `得点   ${this.score}`,
        `速度   ${r.speed.toFixed(0)}  ${r.stalled ? '★失速★' : ''}`,
        `迎え角 ${(r.aoa * 180 / Math.PI).toFixed(1)}°`,
        `スロットル ${THROTTLE_NAMES[this.plane.state.throttle]}${this.plane.state.throttle === 1 ? '（E を押している間）' : ''}`,
        `姿勢   ${this.plane.inverted ? '背面' : '正立'}${this.plane.rolling ? '（ロール中）' : ''}`,
        `HP     ${this.plane.hp}  エンジン${(this.plane.damage.engine * 100).toFixed(0)}% 舵${(this.plane.damage.handling * 100).toFixed(0)}%`,
        `気球   ${this.balloons.list.length}/${BALLOON.maxAlive}`,
        `フィルム ${['切', '弱', '既定', '標準', '強'][this.film?.getLevel() ?? 2]}` +
          `${this.film ? '' : '（WebGL 無効）'}  BGM ${this.bgmOn ? 'on' : 'off'}`,
      ].join('\n'));
    }
  }
}
