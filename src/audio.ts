/**
 * 効果音と BGM。すべて Web Audio でその場で合成する。音源ファイルは持たない。
 * 方向性は samples/art-sound-sample.html で採用済み。
 */

import { AUDIO } from './config';

type Ctx = AudioContext;

export class Sfx {
  private ac: Ctx | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  /** エンジン音は鳴りっぱなしなので、単発の効果音とは別に音量を持たせる */
  private engineBus!: GainNode;
  private engine: EngineVoice | null = null;
  private bgm: Bgm | null = null;
  muted = false;

  /** 最初の入力で呼ぶ。ブラウザは操作前に音を鳴らせない */
  resume(): void {
    if (!this.ac) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ac = new AC();
      const comp = this.ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      this.master = this.ac.createGain();
      this.master.gain.value = AUDIO.master;
      this.sfxBus = this.ac.createGain();
      this.musicBus = this.ac.createGain();
      this.musicBus.gain.value = AUDIO.music;
      this.engineBus = this.ac.createGain();
      this.engineBus.gain.value = AUDIO.engine;
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.engineBus.connect(this.sfxBus);
      this.master.connect(comp);
      comp.connect(this.ac.destination);
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  get ready(): boolean {
    return this.ac !== null;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ac) this.master.gain.value = this.muted ? 0 : AUDIO.master;
    return this.muted;
  }

  private noise(sec: number): AudioBuffer {
    const ac = this.ac!;
    const buf = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * sec)), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private env(g: GainNode, t0: number, attack: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** 銃声。big = 20mm */
  private shot(t0: number, big: boolean): void {
    const ac = this.ac!;
    const n = ac.createBufferSource();
    n.buffer = this.noise(0.4);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = big ? 420 : 1500;
    bp.Q.value = big ? 0.8 : 1.2;
    const g = ac.createGain();
    this.env(g, t0, 0.004, big ? 1.0 : 0.45, big ? 0.5 : 0.09);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t0); n.stop(t0 + 0.6);

    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 170 : 300, t0);
    o.frequency.exponentialRampToValueAtTime(big ? 45 : 120, t0 + (big ? 0.4 : 0.08));
    const og = ac.createGain();
    this.env(og, t0, 0.004, big ? 0.9 : 0.32, big ? 0.45 : 0.08);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t0); o.stop(t0 + 0.6);
  }

  mg(): void {
    if (!this.ac) return;
    this.shot(this.ac.currentTime, false);
  }

  cannon(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.shot(t, true);
    // 装填音
    const ac = this.ac;
    const n = ac.createBufferSource();
    n.buffer = this.noise(0.15);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ac.createGain();
    this.env(g, t + 1.9, 0.004, 0.22, 0.06);
    n.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    n.start(t + 1.9); n.stop(t + 2.1);
  }

  hit(): void {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = this.noise(0.2);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2;
    const g = ac.createGain();
    this.env(g, t, 0.003, 0.5, 0.1);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.25);
    for (const f of [3150, 4230]) {
      const o = ac.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      const og = ac.createGain();
      this.env(og, t, 0.002, 0.16, 0.14);
      o.connect(og); og.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.2);
    }
  }

  explosion(): void {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = this.noise(1.6);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.3);
    const g = ac.createGain();
    this.env(g, t, 0.01, 1.15, 1.3);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 1.6);

    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    const og = ac.createGain();
    this.env(og, t, 0.01, 0.9, 0.9);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + 1.1);
  }

  /** 気球が割れる音。ポンッ＋コミカルな下降笛 */
  pop(): void {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = this.noise(0.1);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = ac.createGain();
    this.env(g, t, 0.002, 0.9, 0.07);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.12);

    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1250, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.75);
    const v = ac.createOscillator();
    v.frequency.value = 9;
    const vg = ac.createGain();
    vg.gain.value = 28;
    v.connect(vg); vg.connect(o.frequency);
    const og = ac.createGain();
    this.env(og, t + 0.09, 0.02, 0.3, 0.68);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t + 0.09); o.stop(t + 0.85);
    v.start(t); v.stop(t + 0.85);
  }

  /** 失速警告。エンジンの息継ぎ＋風切り音 */
  stall(): void {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 68 - i * 5;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 500;
      const g = ac.createGain();
      this.env(g, t + i * 0.22, 0.02, 0.26, 0.13);
      o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
      o.start(t + i * 0.22); o.stop(t + i * 0.22 + 0.2);
    }
    const n = ac.createBufferSource();
    n.buffer = this.noise(1.4);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(2000, t + 1.2);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 1.45);
  }

  /** エンジン音を鳴らしはじめる。level は 1..3 */
  startEngine(): void {
    if (!this.ac || this.engine) return;
    this.engine = new EngineVoice(this.ac, this.engineBus);
  }

  setEngine(level: number, damaged: boolean): void {
    this.engine?.set(level, damaged);
  }

  stopEngine(): void {
    this.engine?.stop();
    this.engine = null;
  }

  toggleBgm(): boolean {
    if (!this.ac) return false;
    if (this.bgm) {
      this.bgm.stop();
      this.bgm = null;
      return false;
    }
    this.bgm = new Bgm(this.ac, this.musicBus);
    this.bgm.start();
    return true;
  }
}

/** プロペラのチョップ感を AM で作るエンジン音 */
class EngineVoice {
  private o1: OscillatorNode;
  private o2: OscillatorNode;
  private chop: OscillatorNode;
  private lp: BiquadFilterNode;
  private g: GainNode;
  private base: GainNode;
  private sputter: number | null = null;

  constructor(private ac: Ctx, out: AudioNode) {
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
    this.o1.start(); this.o2.start(); this.chop.start();
  }

  set(level: number, damaged: boolean): void {
    const t = this.ac.currentTime;
    const f = [0, 46, 64, 88][level] ?? 64;
    const c = [0, 17, 24, 34][level] ?? 24;
    this.o1.frequency.setTargetAtTime(f, t, 0.15);
    this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.15);
    this.chop.frequency.setTargetAtTime(c, t, 0.15);
    this.lp.frequency.setTargetAtTime(300 + level * 330, t, 0.2);
    this.g.gain.setTargetAtTime(0.14 + level * 0.09, t, 0.12);

    if (damaged && this.sputter === null) {
      // 被弾したエンジンは息継ぎする
      this.sputter = window.setInterval(() => {
        const now = this.ac.currentTime;
        this.base.gain.setValueAtTime(0.42, now);
        if (Math.random() < 0.6) {
          this.base.gain.setValueAtTime(0.05, now + 0.03);
          this.base.gain.setValueAtTime(0.42, now + 0.1 + Math.random() * 0.12);
        }
      }, 300);
    } else if (!damaged && this.sputter !== null) {
      clearInterval(this.sputter);
      this.sputter = null;
      this.base.gain.setTargetAtTime(0.42, t, 0.1);
    }
  }

  stop(): void {
    const t = this.ac.currentTime;
    this.g.gain.setTargetAtTime(0, t, 0.1);
    if (this.sputter !== null) clearInterval(this.sputter);
    window.setTimeout(() => {
      this.o1.stop(); this.o2.stop(); this.chop.stop();
    }, 600);
  }
}

/** 1930年代スウィング風のループ「Dogfight Rag」 */
class Bgm {
  private playing = false;
  private timer: number | null = null;
  private step = 0;
  private crackleSrc: AudioBufferSourceNode | null = null;
  private crackleTimer: number | null = null;

  private readonly bpm = 148;
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

  constructor(private ac: Ctx, private out: AudioNode) {}

  private midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  /** 8分音符をスウィング（2:1）に振る */
  private swingTime(step: number): number {
    const q = 60 / this.bpm;
    return Math.floor(step / 2) * q + (step % 2 ? q * 0.66 : 0);
  }

  private noise(sec: number): AudioBuffer {
    const buf = this.ac.createBuffer(1, Math.floor(this.ac.sampleRate * sec), this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

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
    n.buffer = this.noise(0.12);
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
  private startCrackle(): void {
    const n = this.ac.createBufferSource();
    n.buffer = this.noise(2); n.loop = true;
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    const g = this.ac.createGain(); g.gain.value = 0.016;
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.out);
    n.start();
    this.crackleSrc = n;
    this.crackleTimer = window.setInterval(() => {
      if (!this.playing) return;
      const t = this.ac.currentTime + Math.random() * 0.4;
      const p = this.ac.createBufferSource();
      p.buffer = this.noise(0.012);
      const pg = this.ac.createGain();
      pg.gain.value = 0.1 + Math.random() * 0.12;
      p.connect(pg); pg.connect(this.out);
      p.start(t);
    }, 700);
  }

  start(): void {
    const ac = this.ac;
    this.playing = true;
    const totalSteps = 64, q = 60 / this.bpm, loopSec = 32 * q;
    const origin = ac.currentTime + 0.08;
    this.startCrackle();

    const timeOf = (step: number): number =>
      origin + Math.floor(step / totalSteps) * loopSec + this.swingTime(step % totalSteps);

    const tick = (): void => {
      if (!this.playing) return;
      const ahead = ac.currentTime + 0.3;
      while (timeOf(this.step) < ahead) {
        const s = this.step % totalSteps;
        const t = timeOf(this.step);
        const bar = Math.floor(s / 8);
        this.ride(t, s % 8 === 2 || s % 8 === 6);
        if (s % 2 === 0) this.bass(t, this.midi(this.bassLine[bar][(s % 8) / 2]));
        if (s % 8 === 3 || s % 8 === 6) this.stab(t, this.chords[this.compBars[bar]]);
        for (const m of this.melody) {
          if (m[0] !== s) continue;
          const dur = this.swingTime(Math.min(m[0] + m[2], totalSteps)) - this.swingTime(m[0]);
          this.trumpet(t, this.midi(m[1]), Math.max(dur * 0.92, 0.13));
        }
        this.step++;
      }
      this.timer = window.setTimeout(tick, 80);
    };
    tick();
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.crackleTimer !== null) clearInterval(this.crackleTimer);
    this.crackleSrc?.stop();
    this.step = 0;
  }
}
