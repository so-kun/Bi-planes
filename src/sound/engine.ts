/**
 * エンジン音。機体ごとに1つ持ち、鳴りっぱなしで段階だけを変える。
 * 傷んだときの息継ぎと、水温が上がりすぎたときの荒れもここで作る。
 *
 * **過熱は「入切」ではなく度合いで効く**（2026-08-15 改定）。
 * 赤帯に入った瞬間だけ音が変わって、あとは振り切れるまで同じだったので、
 * 「まずい」と気づけなかった。赤帯から振り切れまでを 0〜1 として、
 * 踏み込むほど次の4つが強くなる:
 *
 *   1. **失火** … 燃え損ねて音が飛ぶ。踏み込むほど頻繁につんのめる
 *   2. **ノッキング** … 金属を叩く音。**回転に噛み合わせて**鳴らす（等間隔だと機械の音に聞こえない）
 *   3. **うなり** … 回転そのものが不揃いになる（音程の揺れ）
 *   4. **蒸気** … うっすらとした噴き出し。上の3つを支えるだけの薄さで足す
 */

import { onTimer, type Ctx } from './tone';

/** プロペラのチョップ感を AM で作るエンジン音 */
export class EngineVoice {
  private o1: OscillatorNode;
  private o2: OscillatorNode;
  private chop: OscillatorNode;
  private lp: BiquadFilterNode;
  private g: GainNode;
  private base: GainNode;
  /** 過熱したときだけ効かせる、うなり（音程の細かい揺れ） */
  private wobble: OscillatorNode;
  private wobbleG: GainNode;
  /** 過熱したときの、うっすらとした蒸気 */
  private hiss: AudioBufferSourceNode;
  private hissG: GainNode;
  private sputter: number | null = null;
  /** 過熱したときの金属的なノッキング */
  private knocker: number | null = null;
  /** 過熱で燃え損ねる（音が飛ぶ） */
  private misfire: number | null = null;

  /** いまの踏み込み具合（0 = 赤帯の手前、1 = 振り切れ）。タイマーの中から読む */
  private strain = 0;
  /** いまのプロペラの刻み（Hz）。ノッキングをこれに噛み合わせる */
  private chopHz = 24;

  /** 段階ごとの基音と、爆発の刻みの速さ */
  private static readonly PITCH = [0, 46, 64, 88];
  private static readonly CHOP = [0, 17, 24, 34];

  constructor(
    private ac: Ctx,
    private out: AudioNode,
    noise: AudioBuffer,
    level = 2,
    damaged = false,
    strain = 0,
  ) {
    this.o1 = ac.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ac.createOscillator(); this.o2.type = 'square'; this.o2.detune.value = 9;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass';
    this.g = ac.createGain(); this.g.gain.value = 0;
    this.base = ac.createGain(); this.base.gain.value = 0.42;
    this.chop = ac.createOscillator(); this.chop.type = 'square';
    const chopG = ac.createGain(); chopG.gain.value = 0.4;
    this.chop.connect(chopG); chopG.connect(this.g.gain);
    this.o1.connect(this.lp); this.o2.connect(this.lp);
    this.lp.connect(this.g); this.g.connect(this.base); this.base.connect(out);

    // 回りが不揃いになる感じは、片方の発振器の音程をゆっくり揺らして作る。
    // 平常時は揺れ幅 0 なので鳴りに影響しない
    this.wobble = ac.createOscillator(); this.wobble.type = 'sine';
    this.wobble.frequency.value = 6.4;
    this.wobbleG = ac.createGain(); this.wobbleG.gain.value = 0;
    this.wobble.connect(this.wobbleG); this.wobbleG.connect(this.o2.detune);

    // 蒸気。広い帯の雑音をうっすら乗せる。平常時は音量 0
    this.hiss = ac.createBufferSource();
    this.hiss.buffer = noise;
    this.hiss.loop = true;
    const hissBp = ac.createBiquadFilter();
    hissBp.type = 'bandpass'; hissBp.frequency.value = 2600; hissBp.Q.value = 0.7;
    this.hissG = ac.createGain(); this.hissG.gain.value = 0;
    this.hiss.connect(hissBp); hissBp.connect(this.hissG); this.hissG.connect(out);

    // 発振器は何も指定しないと 440Hz（ラの音）で鳴る。
    // 刻みの発振器まで 440Hz で回るため、そのままだと機関の音ではなく甲高い音になる。
    // 作った時点で目的の段階に合わせておく。音量だけは 0 から始めて、set() で立ち上げる
    const f = EngineVoice.PITCH[level] ?? 64;
    this.o1.frequency.value = f;
    this.o2.frequency.value = f * 2.01;
    this.chop.frequency.value = EngineVoice.CHOP[level] ?? 24;
    this.lp.frequency.value = 300 + level * 330;

    this.o1.start(); this.o2.start(); this.chop.start(); this.wobble.start(); this.hiss.start();
    this.set(level, damaged, strain);
  }

  /**
   * @param strain 水温の踏み込み具合。0 = 赤帯の手前、1 = 振り切れ。
   *               入切の2値ではないので、赤帯に入ってから少しずつ荒れていく
   */
  set(level: number, damaged: boolean, strain = 0): void {
    const t = this.ac.currentTime;
    const s = Math.max(0, Math.min(1, strain));
    this.strain = s;

    // 過熱すると回転が上ずり、音がざらつく
    const f = (EngineVoice.PITCH[level] ?? 64) * (1 + 0.05 * s);
    const c = (EngineVoice.CHOP[level] ?? 24) * (1 + 0.05 * s);
    this.chopHz = c;
    this.o1.frequency.setTargetAtTime(f, t, 0.15);
    this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.15);
    this.chop.frequency.setTargetAtTime(c, t, 0.15);
    this.lp.frequency.setTargetAtTime(300 + level * 330 + 620 * s, t, 0.2);
    this.g.gain.setTargetAtTime(0.14 + level * 0.09, t, 0.12);
    this.wobbleG.gain.setTargetAtTime(s > 0 ? 26 + 58 * s : 0, t, 0.25);
    this.hissG.gain.setTargetAtTime(0.056 * s, t, 0.35);

    this.setKnocking(s > 0);
    this.setMisfiring(s > 0);

    if (damaged && this.sputter === null) {
      // 被弾したエンジンは息継ぎする
      this.sputter = window.setInterval(onTimer('息継ぎ', () => {
        const now = this.ac.currentTime;
        this.base.gain.setValueAtTime(0.42, now);
        if (Math.random() < 0.6) {
          this.base.gain.setValueAtTime(0.05, now + 0.03);
          this.base.gain.setValueAtTime(0.42, now + 0.1 + Math.random() * 0.12);
        }
      }), 300);
    } else if (!damaged && this.sputter !== null) {
      clearInterval(this.sputter);
      this.sputter = null;
      if (this.misfire === null) this.base.gain.setTargetAtTime(0.42, t, 0.1);
    }
  }

  /**
   * ノッキング。**回転の何発かに一度**打つ。
   * 等間隔で鳴らすと機械ではなく節になってしまうので、刻みの周期から間隔を作り、
   * 踏み込むほど間隔を詰める
   */
  private setKnocking(on: boolean): void {
    if (!on) {
      if (this.knocker !== null) { clearTimeout(this.knocker); this.knocker = null; }
      return;
    }
    if (this.knocker !== null) return;          // もう回っている。間隔はその都度決める
    const tick = onTimer('ノッキング', () => {
      const s = this.strain;
      if (s <= 0) { this.knocker = null; return; }
      this.knock(0.75 * (0.35 + 0.75 * s));
      const every = Math.max(2, Math.round(9 - 6 * s) + (Math.random() < 0.35 ? 1 : 0));
      this.knocker = window.setTimeout(tick, (every / Math.max(1, this.chopHz)) * 1000);
    });
    this.knocker = window.setTimeout(tick, 60);
  }

  /**
   * 失火。燃え損ねて音が飛ぶ。
   * 息継ぎ（被弾）より短く、より頻繁で、踏み込むほど増える ――
   * 「エンジンがつんのめっている」のが、水温計を見なくても分かるように
   */
  private setMisfiring(on: boolean): void {
    if (!on) {
      if (this.misfire !== null) {
        clearInterval(this.misfire);
        this.misfire = null;
        if (this.sputter === null) this.base.gain.setTargetAtTime(0.42, this.ac.currentTime, 0.1);
      }
      return;
    }
    if (this.misfire !== null) return;
    this.misfire = window.setInterval(onTimer('失火', () => {
      const s = this.strain;
      if (s <= 0 || Math.random() > 0.12 + 0.55 * s) return;
      const now = this.ac.currentTime;
      this.base.gain.setValueAtTime(0.42, now);
      this.base.gain.setValueAtTime(0.05, now + 0.01);
      this.base.gain.setValueAtTime(0.42, now + 0.05 + Math.random() * 0.09);
    }), 190);
  }

  /**
   * ノッキングのひと打ち。高いところから短く落ちる音を、
   * 狭い帯だけ通して金属らしく響かせ、細い余韻を添えて鉄を打った音に寄せる
   */
  private knock(amp: number): void {
    const t = this.ac.currentTime;
    const peak = Math.max(0.02, Math.min(1.1, amp));

    const o = this.ac.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(300 + Math.random() * 120, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.05);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1050 + Math.random() * 450;
    bp.Q.value = 3.2;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    o.connect(bp); bp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.09);

    const ring = this.ac.createOscillator();
    ring.type = 'triangle';
    ring.frequency.setValueAtTime(1750 + Math.random() * 500, t);
    const rg = this.ac.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(peak * 0.28, t + 0.006);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    ring.connect(rg); rg.connect(this.out);
    ring.start(t); ring.stop(t + 0.24);
  }

  stop(): void {
    const t = this.ac.currentTime;
    this.g.gain.setTargetAtTime(0, t, 0.1);
    this.hissG.gain.setTargetAtTime(0, t, 0.1);
    if (this.sputter !== null) clearInterval(this.sputter);
    if (this.knocker !== null) clearTimeout(this.knocker);
    if (this.misfire !== null) clearInterval(this.misfire);
    window.setTimeout(() => {
      this.o1.stop(); this.o2.stop(); this.chop.stop(); this.wobble.stop(); this.hiss.stop();
    }, 600);
  }
}
