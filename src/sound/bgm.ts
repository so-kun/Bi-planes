/**
 * BGM。対戦の曲とステージ選択の曲の2つを、Web Audio でその場で合成する。
 *
 * 拍は AudioContext の時計で決め、タイマーは「先の分を予約する」ためだけに使う。
 * setTimeout の精度で鳴らすと拍が揺れるため。
 */

import { note } from '../diagnostics';
import { noiseBuffer, noiseFrom, onTimer, type Ctx } from './tone';

export type BgmKind = 'menu' | 'battle';

/**
 * 曲の土台。決まった長さの「手」を並べていく仕掛けだけを持つ。
 * 何を鳴らすかは継承先が書く。
 *
 * 先の分まで前倒しで予約するのは、setTimeout の精度では拍が揺れるため ――
 * 鳴らす時刻は AudioContext の時計で決め、予約だけをタイマーで回す
 */
export abstract class Track {
  abstract readonly kind: BgmKind;
  /** 一周の手数 */
  protected abstract readonly steps: number;
  /** 1手の長さ（秒）。8分音符ぶん */
  protected abstract readonly stepDur: number;
  /** 8分を跳ねさせる（2:1）か */
  protected readonly swing: boolean = false;
  /**
   * 曲ごとの音量。曲によって同時に鳴る音の数が違うので、ここでそろえる。
   * 実測でならした値（対戦の曲を基準に、実効値が同じになるところ）
   */
  protected readonly level: number = 1;

  protected playing = false;
  private timer: number | null = null;
  private step = 0;

  constructor(protected ac: Ctx, protected out: AudioNode) {}

  /** その手で鳴らす音を並べる */
  protected abstract emit(step: number, t: number): void;
  /** 鳴りっぱなしのものを足したいとき（レコードの針音など） */
  protected began(): void {}
  protected ended(): void {}

  protected midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private stepTime(step: number): number {
    if (!this.swing) return step * this.stepDur;
    return Math.floor(step / 2) * 2 * this.stepDur + (step % 2 ? this.stepDur * 1.32 : 0);
  }

  start(): void {
    this.playing = true;
    if (this.level !== 1) {
      const g = this.ac.createGain();
      g.gain.value = this.level;
      g.connect(this.out);
      this.out = g;
    }
    const origin = this.ac.currentTime + 0.08;
    const loop = this.stepTime(this.steps);
    const timeOf = (step: number): number =>
      origin + Math.floor(step / this.steps) * loop + this.stepTime(step % this.steps);
    this.began();

    // ここはタイマーの中なので、例外を出しても画面は止まらない。
    // ただし次の予約に届かず曲がそこで途切れるので、受け止めて曲だけを閉じる
    const tick = (): void => {
      if (!this.playing) return;
      try {
        const ahead = this.ac.currentTime + 0.3;
        while (timeOf(this.step) < ahead) {
          this.emit(this.step % this.steps, timeOf(this.step));
          this.step++;
        }
      } catch (err) {
        this.playing = false;
        note(`曲を止めました。ゲームはそのまま続きます。\n  ${String(err)}`);
        console.error(err);
        return;
      }
      this.timer = window.setTimeout(tick, 80);
    };
    tick();
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.ended();
    this.step = 0;
  }
}

/** 対戦中の曲。1930年代スウィング風のループ「Dogfight Rag」 */
export class BattleBgm extends Track {
  override readonly kind = 'battle';
  protected override readonly steps = 64;
  protected override readonly stepDur = (60 / 148) / 2;
  protected override readonly swing = true;

  private crackleSrc: AudioBufferSourceNode | null = null;
  private crackleTimer: number | null = null;

  private readonly chords: Record<string, number[]> = {
    F6: [65, 69, 72, 74], Bb6: [70, 74, 77, 79], Bdim: [71, 74, 77, 80],
    D7: [62, 66, 69, 72], Gm7: [67, 70, 74, 77], C7: [60, 64, 67, 70],
  };
  private readonly bassLine = [
    [41, 45, 48, 50], [41, 45, 48, 46], [46, 50, 53, 55], [47, 50, 53, 50],
    [41, 45, 48, 50], [38, 42, 45, 48], [43, 50, 36, 43], [41, 45, 36, 43],
  ];
  private readonly compBars = ['F6', 'F6', 'Bb6', 'Bdim', 'F6', 'D7', 'Gm7', 'C7'];
  private readonly melody: [number, number, number][] = [
    [0, 65, 1], [1, 69, 1], [2, 72, 2], [4, 74, 1], [6, 72, 2],
    [10, 69, 1], [11, 72, 1], [12, 74, 1], [13, 77, 3],
    [16, 77, 1], [18, 74, 1], [20, 70, 2], [22, 67, 1],
    [24, 71, 2], [26, 74, 2], [30, 72, 1],
    [32, 69, 1], [34, 65, 2], [38, 69, 1], [39, 72, 1],
    [40, 74, 2], [42, 72, 1], [43, 69, 1], [44, 66, 2], [46, 69, 1],
    [48, 67, 2], [50, 70, 1], [52, 76, 2], [54, 74, 1],
    [56, 77, 3], [62, 72, 1],
  ];

  private trumpet(t: number, f: number, dur: number): void {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    const v = ac.createOscillator(); v.frequency.value = 5.6;
    const vg = ac.createGain(); vg.gain.value = f * 0.012;
    v.connect(vg); vg.connect(o.frequency);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.2; bp.Q.value = 1.1;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.03);
    g.gain.setValueAtTime(0.2, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
    v.start(t); v.stop(t + dur + 0.05);
  }

  private bass(t: number, f: number): void {
    const o = this.ac.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.4);
  }

  private ride(t: number, accent: boolean): void {
    const n = this.ac.createBufferSource();
    n.buffer = noiseBuffer(this.ac);
    const hp = this.ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6200;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(accent ? 0.09 : 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (accent ? 0.11 : 0.05));
    n.connect(hp); hp.connect(g); g.connect(this.out);
    n.start(t); n.stop(t + 0.13);
  }

  private stab(t: number, tones: number[]): void {
    for (const n of tones) {
      const o = this.ac.createOscillator();
      o.type = 'triangle'; o.frequency.value = this.midi(n);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + 0.2);
    }
  }

  /** レコードのノイズ */
  protected override began(): void {
    const n = this.ac.createBufferSource();
    n.buffer = noiseBuffer(this.ac); n.loop = true;
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    const g = this.ac.createGain(); g.gain.value = 0.016;
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.out);
    n.start();
    this.crackleSrc = n;
    this.crackleTimer = window.setInterval(onTimer('レコードの針音', () => {
      if (!this.playing) return;
      const t = this.ac.currentTime + Math.random() * 0.4;
      const p = this.ac.createBufferSource();
      p.buffer = noiseBuffer(this.ac);
      const pg = this.ac.createGain();
      pg.gain.value = 0.1 + Math.random() * 0.12;
      p.connect(pg); pg.connect(this.out);
      p.start(t, noiseFrom(0.012)); p.stop(t + 0.012);
    }), 700);
  }

  protected override ended(): void {
    if (this.crackleTimer !== null) clearInterval(this.crackleTimer);
    this.crackleSrc?.stop();
    this.crackleSrc = null;
  }

  protected override emit(s: number, t: number): void {
    const bar = Math.floor(s / 8);
    this.ride(t, s % 8 === 2 || s % 8 === 6);
    if (s % 2 === 0) this.bass(t, this.midi(this.bassLine[bar][(s % 8) / 2]));
    if (s % 8 === 3 || s % 8 === 6) this.stab(t, this.chords[this.compBars[bar]]);
    for (const m of this.melody) {
      if (m[0] !== s) continue;
      const dur = (Math.min(m[0] + m[2], this.steps) - m[0]) * this.stepDur;
      this.trumpet(t, this.midi(m[1]), Math.max(dur * 0.92, 0.13));
    }
  }
}

/**
 * ステージ選択の曲「ニュース映画の行進曲」（2026-08-13 採用）。
 * 2拍子・116拍のマーチ。チューバのオムパ、小太鼓のロール、金管のファンファーレ。
 * 対戦の曲とは拍子で差が付くので、画面が変わったことが音で分かる。
 * レコードの針音は入れない（採用時の指定）
 */
export class MenuBgm extends Track {
  override readonly kind = 'menu';
  protected override readonly steps = 32;          // 8小節 × 2拍 × 2（8分）
  protected override readonly stepDur = (60 / 116) / 2;
  // マーチは同時に鳴る音が多く、そのままだと対戦の曲より 2.5 倍ほど大きい。
  // 実測（実効値）でそろえた値
  protected override readonly level = 0.40;

  private readonly chords: Record<string, number[]> = {
    Bb: [58, 62, 65], F7: [57, 60, 63, 65], Eb: [58, 63, 67],
  };
  private readonly bars = ['Bb', 'Bb', 'F7', 'F7', 'Bb', 'Eb', 'Bb', 'F7'];
  /** 小節ごとの、表拍と裏拍のベース音 */
  private readonly bassBars = [
    [46, 41], [46, 41], [41, 48], [41, 48], [46, 41], [39, 46], [46, 41], [41, 48],
  ];
  /** [8分単位の位置, 音, 長さ] */
  private readonly melody: [number, number, number][] = [
    [0, 70, 1], [1, 70, 1], [2, 74, 2], [4, 77, 2], [6, 74, 2],
    [8, 72, 1], [9, 75, 1], [10, 72, 2], [12, 69, 4],
    [16, 70, 1], [17, 74, 1], [18, 77, 2], [20, 79, 2], [22, 75, 2],
    [24, 74, 1], [25, 72, 1], [26, 70, 2], [28, 72, 2], [30, 69, 2],
  ];

  private brass(t: number, f: number, dur: number): void {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.975, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.3; bp.Q.value = 1.2;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.028);
    g.gain.setValueAtTime(0.16, t + Math.max(0.04, dur - 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.12);
  }

  /** チューバ。低くて短い、マーチのオムパ */
  private tuba(t: number, f: number): void {
    const o = this.ac.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.setValueAtTime(0.5, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + 0.36);
  }

  /** 裏拍の刻み。少しばらして弾く */
  private pluck(t: number, tones: number[]): void {
    tones.forEach((n, i) => {
      const o = this.ac.createOscillator();
      o.type = 'triangle'; o.frequency.value = this.midi(n);
      const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      const g = this.ac.createGain();
      const at = t + i * 0.006;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.06, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      o.connect(lp); lp.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + 0.3);
    });
  }

  private snare(t: number, peak: number): void {
    const n = this.ac.createBufferSource();
    n.buffer = noiseBuffer(this.ac);
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(hp); hp.connect(g); g.connect(this.out);
    n.start(t, noiseFrom(0.09)); n.stop(t + 0.09);
  }

  private cymbal(t: number): void {
    const n = this.ac.createBufferSource();
    n.buffer = noiseBuffer(this.ac);
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    n.connect(hp); hp.connect(g); g.connect(this.out);
    n.start(t, noiseFrom(0.65)); n.stop(t + 0.65);
  }

  protected override emit(s: number, t: number): void {
    const bar = Math.floor(s / 4);
    const half = s % 4;
    if (half % 2 === 0) this.tuba(t, this.midi(this.bassBars[bar][half / 2]));
    else this.pluck(t, this.chords[this.bars[bar]]);
    // 小太鼓は16分のロール。拍の頭だけ強く打つ
    for (let k = 0; k < 2; k++) {
      this.snare(t + k * this.stepDur / 2, half % 2 === 0 && k === 0 ? 0.13 : 0.055);
    }
    if (s === 0) this.cymbal(t);
    for (const m of this.melody) {
      if (m[0] !== s) continue;
      this.brass(t, this.midi(m[1]), m[2] * this.stepDur * 0.88);
    }
  }
}
