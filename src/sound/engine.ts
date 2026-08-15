/**
 * エンジン音。機体ごとに1つ持ち、鳴りっぱなしで段階だけを変える。
 * 傷んだときの息継ぎと、水温が振り切れたときのノッキングもここで作る。
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
  private sputter: number | null = null;
  /** 過熱したときの金属的なノッキング */
  private knocker: number | null = null;

  /** 段階ごとの基音と、爆発の刻みの速さ */
  private static readonly PITCH = [0, 46, 64, 88];
  private static readonly CHOP = [0, 17, 24, 34];

  constructor(private ac: Ctx, private out: AudioNode, level = 2, damaged = false, strained = false) {
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

    // 発振器は何も指定しないと 440Hz（ラの音）で鳴る。
    // 刻みの発振器まで 440Hz で回るため、そのままだと機関の音ではなく甲高い音になる。
    // 作った時点で目的の段階に合わせておく。音量だけは 0 から始めて、set() で立ち上げる
    const f = EngineVoice.PITCH[level] ?? 64;
    this.o1.frequency.value = f;
    this.o2.frequency.value = f * 2.01;
    this.chop.frequency.value = EngineVoice.CHOP[level] ?? 24;
    this.lp.frequency.value = 300 + level * 330;

    this.o1.start(); this.o2.start(); this.chop.start(); this.wobble.start();
    this.set(level, damaged, strained);
  }

  set(level: number, damaged: boolean, strained = false): void {
    const t = this.ac.currentTime;
    // 過熱すると回転が上ずり、音がざらつく
    const up = strained ? 1.07 : 1;
    const f = (EngineVoice.PITCH[level] ?? 64) * up;
    const c = (EngineVoice.CHOP[level] ?? 24) * up;
    this.o1.frequency.setTargetAtTime(f, t, 0.15);
    this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.15);
    this.chop.frequency.setTargetAtTime(c, t, 0.15);
    this.lp.frequency.setTargetAtTime(300 + level * 330 + (strained ? 620 : 0), t, 0.2);
    this.g.gain.setTargetAtTime(0.14 + level * 0.09, t, 0.12);
    this.wobbleG.gain.setTargetAtTime(strained ? 42 : 0, t, 0.25);

    if (strained && this.knocker === null) {
      // 水温が振り切れる手前の、金属を叩くようなノッキング
      this.knocker = window.setInterval(onTimer('ノッキング', () => {
        if (Math.random() < 0.25) return;
        this.knock();
      }), 130);
    } else if (!strained && this.knocker !== null) {
      clearInterval(this.knocker);
      this.knocker = null;
    }

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
      this.base.gain.setTargetAtTime(0.42, t, 0.1);
    }
  }

  /**
   * ノッキングのひと打ち。高いところから短く落ちる音を、
   * 狭い帯だけ通して金属らしく響かせる
   */
  private knock(): void {
    const t = this.ac.currentTime;
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
    g.gain.exponentialRampToValueAtTime(0.55 + Math.random() * 0.35, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    o.connect(bp); bp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.09);
  }

  stop(): void {
    const t = this.ac.currentTime;
    this.g.gain.setTargetAtTime(0, t, 0.1);
    if (this.sputter !== null) clearInterval(this.sputter);
    if (this.knocker !== null) clearInterval(this.knocker);
    window.setTimeout(() => {
      this.o1.stop(); this.o2.stop(); this.chop.stop(); this.wobble.stop();
    }, 600);
  }
}

