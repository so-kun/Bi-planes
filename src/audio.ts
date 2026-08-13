/**
 * 効果音と BGM。すべて Web Audio でその場で合成する。音源ファイルは持たない。
 * 方向性は samples/art-sound-sample.html で採用済み。
 */

import { AUDIO } from './config';
import { note } from './diagnostics';

type Ctx = AudioContext;

/**
 * 雑音の素は**一度だけ**作って使い回す。
 *
 * もとは音を鳴らすたびに `createBuffer` して `Math.random()` で埋めていた。
 * 機銃は 0.09 秒ごとに鳴るので、2機ぶんで毎秒 42 万回の乱数と 1.7MB の確保 ――
 * それが全部、描画の輪の中で起きていた。速いブラウザなら気づかない程度でも、
 * 遅いところでは輪ごと詰まり、「音を鳴らすと操作が効かなくなる」ように見える。
 *
 * 同じ波形の使い回しで音が単調にならないよう、鳴らすたびに
 * 読み出しはじめる場所を変える（`noiseFrom`）
 */
const NOISE_SEC = 3;
const noiseBuffers = new WeakMap<Ctx, AudioBuffer>();

function noiseBuffer(ac: Ctx): AudioBuffer {
  const hit = noiseBuffers.get(ac);
  if (hit) return hit;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * NOISE_SEC), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ac, buf);
  return buf;
}

/** 雑音を読み出しはじめる場所。dur 秒ぶん読み切れる範囲で毎回ずらす */
function noiseFrom(dur: number): number {
  return Math.random() * Math.max(0, NOISE_SEC - dur);
}

/**
 * タイマーで回す音の処理を包む。
 *
 * タイマーはゲームの輪とは別に動くので、ここで例外が出ても画面は止まらない。
 * ただし黙って壊れ続けるのは困るので、一度失敗したらそのタイマーだけを閉じ、
 * 何が起きたかを画面に出す
 */
function onTimer(what: string, fn: () => void): () => void {
  let broken = false;
  return () => {
    if (broken) return;
    try {
      fn();
    } catch (err) {
      broken = true;
      note(`音の一部を止めました（${what}）。ゲームはそのまま続きます。\n  ${String(err)}`);
      console.error(err);
    }
  };
}

export class Sfx {
  private ac: Ctx | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  /** エンジン音は鳴りっぱなしなので、単発の効果音とは別に音量を持たせる */
  private engineBus!: GainNode;
  /** 機体ごとのエンジン音。2人対戦では2つ鳴る */
  private engines: (EngineVoice | null)[] = [];
  /** 音を鳴らせるようになる前に要求された段階。鳴らしはじめるときに使う */
  private engineLevel: number[] = [];
  private engineDamaged: boolean[] = [];
  /** 水温が赤帯に入っているか。入っていると音がざらつく */
  private engineStrained: boolean[] = [];
  private bgm: Track | null = null;
  /** 今どの曲を鳴らしたいか。B キーで切っても、次の画面で戻せるように覚えておく */
  private bgmKind: BgmKind = 'battle';
  /** B キーで切られていないか */
  private bgmEnabled = true;
  muted = false;
  /** 音の用意に失敗したか。失敗しても、ゲームは音なしで続ける */
  private failed = false;

  /** 最初の入力で呼ぶ。ブラウザは操作前に音を鳴らせない */
  resume(): void {
    if (this.failed) return;
    if (!this.ac) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // 途中で失敗しても中途半端な状態を残さないよう、組み上げてから this.ac に入れる
      const ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      const master = ac.createGain();
      master.gain.value = AUDIO.master;
      const sfxBus = ac.createGain();
      const musicBus = ac.createGain();
      musicBus.gain.value = AUDIO.music;
      const engineBus = ac.createGain();
      engineBus.gain.value = AUDIO.engine;
      sfxBus.connect(master);
      musicBus.connect(master);
      engineBus.connect(sfxBus);
      master.connect(comp);
      comp.connect(ac.destination);
      this.master = master;
      this.sfxBus = sfxBus;
      this.musicBus = musicBus;
      this.engineBus = engineBus;
      this.ac = ac;
    }
    // resume() は約束を返す。断られても放っておくと未処理の失敗になるので受け止める
    if (this.ac.state === 'suspended') {
      this.ac.resume().catch((err: unknown) => {
        this.failed = true;
        note(`音を鳴らしはじめられませんでした。音なしで続けます。\n  ${String(err)}`);
      });
    }
  }

  get ready(): boolean {
    return this.ac !== null;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ac) this.master.gain.value = this.muted ? 0 : AUDIO.master;
    return this.muted;
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
    n.buffer = noiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = big ? 420 : 1500;
    bp.Q.value = big ? 0.8 : 1.2;
    const g = ac.createGain();
    this.env(g, t0, 0.004, big ? 1.0 : 0.45, big ? 0.5 : 0.09);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t0, noiseFrom(0.6)); n.stop(t0 + 0.6);

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
    n.buffer = noiseBuffer(ac);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ac.createGain();
    this.env(g, t + 1.9, 0.004, 0.22, 0.06);
    n.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    n.start(t + 1.9, noiseFrom(0.2)); n.stop(t + 2.1);
  }

  hit(): void {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = noiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2;
    const g = ac.createGain();
    this.env(g, t, 0.003, 0.5, 0.1);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t, noiseFrom(0.25)); n.stop(t + 0.25);
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
    n.buffer = noiseBuffer(ac);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.3);
    const g = ac.createGain();
    this.env(g, t, 0.01, 1.15, 1.3);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    n.start(t, noiseFrom(1.6)); n.stop(t + 1.6);

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
    n.buffer = noiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = ac.createGain();
    this.env(g, t, 0.002, 0.9, 0.07);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t, noiseFrom(0.12)); n.stop(t + 0.12);

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
    n.buffer = noiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(2000, t + 1.2);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t, noiseFrom(1.45)); n.stop(t + 1.45);
  }

  /**
   * エンジン音を count 機ぶん鳴らしはじめる。
   *
   * 音はブラウザの決まりで操作があるまで鳴らせないので、この呼び出しは
   * ゲームが動きはじめたあとになる。それまでに要求された段階を覚えておいて、
   * 作った瞬間からその段階で鳴らす。覚えずにいると、段階が変わるまで
   * 既定のままの音が鳴り続ける
   */
  startEngines(count: number): void {
    if (!this.ac) return;
    for (let i = 0; i < count; i++) {
      if (this.engines[i]) continue;
      this.engines[i] = new EngineVoice(
        this.ac, this.engineBus, this.engineLevel[i] ?? 2, this.engineDamaged[i] ?? false,
        this.engineStrained[i] ?? false,
      );
    }
    this.balanceEngines();
  }

  setEngine(index: number, level: number, damaged: boolean, strained = false): void {
    this.engineLevel[index] = level;
    this.engineDamaged[index] = damaged;
    this.engineStrained[index] = strained;
    this.engines[index]?.set(level, damaged, strained);
  }

  stopEngines(): void {
    for (const e of this.engines) e?.stop();
    this.engines = [];
  }

  /**
   * 鳴っている数だけ音が重なって大きくなるので、まとめて絞る。
   * 2機で単純に2倍にはせず、耳で感じる大きさが揃うくらいにする
   */
  private balanceEngines(): void {
    const n = this.engines.filter(Boolean).length;
    if (!n) return;
    this.engineBus.gain.value = AUDIO.engine / Math.sqrt(n);
  }

  /**
   * カウントダウンの合図。3・2・1 は低く、GO! は高く鳴らす。
   * 木管のような柔らかい音にして、戦闘中の効果音と混同しないようにする
   */
  beep(go = false): void {
    if (!this.ac) return;
    const ac = this.ac;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(go ? 784 : 392, t);          // ソ（GO は 1 オクターブ上）
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.55 : 0.22));
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = go ? 2600 : 1500;
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + (go ? 0.6 : 0.28));
  }

  /**
   * その画面の曲を鳴らす。同じ曲がもう鳴っていれば何もしない ――
   * 画面を作り直すたびに頭から鳴り直すのを防ぐため
   */
  playBgm(kind: BgmKind): void {
    this.bgmKind = kind;
    if (!this.ac || !this.bgmEnabled) return;
    if (this.bgm && this.bgm.kind === kind) return;
    this.bgm?.stop();
    this.bgm = kind === 'menu' ? new MenuBgm(this.ac, this.musicBus) : new BattleBgm(this.ac, this.musicBus);
    this.bgm.start();
  }

  stopBgm(): void {
    this.bgm?.stop();
    this.bgm = null;
  }

  get bgmPlaying(): boolean {
    return this.bgm !== null;
  }

  /** B キーの入／切。切っても「どの曲か」は覚えたままにする */
  toggleBgm(): boolean {
    if (!this.ac) return false;
    if (this.bgm) {
      this.bgmEnabled = false;
      this.stopBgm();
      return false;
    }
    this.bgmEnabled = true;
    this.playBgm(this.bgmKind);
    return true;
  }

  // ------------------------------------------------------------ ステージ選択の音

  /** 金管のひと吹き。決定の合図に使う */
  private brass(t: number, f: number, dur: number, peak: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.975, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f * 2.3; bp.Q.value = 1.2;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.028);
    g.gain.setValueAtTime(peak, t + Math.max(0.03, dur - 0.07));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.12);
  }

  /** 澄んだ短い音。カーソルの音の素 */
  private chime(t: number, f: number, peak: number, dur: number): void {
    const ac = this.ac!;
    const o = ac.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** カーソル移動。5度上に跳ねる小さなチャイム（2026-08-13 採用） */
  menuMove(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.chime(t, 1046, 0.24, 0.17);
    this.chime(t + 0.03, 1568, 0.16, 0.21);
  }

  /** 腕前の左右。カーソルの音を、弱いほうへは低く・強いほうへは高くしたもの */
  menuLevel(dir: -1 | 1): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const f = dir < 0 ? 784 : 1319;
    this.chime(t, f, 0.25, 0.17);
    this.chime(t + 0.03, f * 1.5, 0.17, 0.20);
  }

  /** 決定。金管の小さなファンファーレ */
  menuDecide(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const [f, d] of [[523, 0], [659, 0.055], [784, 0.11]] as [number, number][]) {
      this.brass(t + d, f, 0.16, 0.18);
    }
    this.brass(t + 0.17, 1046, 0.42, 0.2);
  }

  /** 戻る。決定を裏返した、下がる2音 */
  menuBack(): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.chime(t, 587, 0.18, 0.10);
    this.chime(t + 0.07, 392, 0.20, 0.22);
  }
}

/**
 * 音のせいでゲームが止まらないようにする覆い。やることは2つ。
 *
 * **1. 例外を外に出さない。** 音の呼び出しは入力や毎フレームの処理の中から起きる。
 * Phaser は毎フレームの処理を済ませてから次のフレームを予約するので、ここで例外が出ると
 * 画面がその場で止まり、**キーもパッドも一切効かなくなる**。
 * 原因が音でも、症状は「操作を受け付けない」になる。
 *
 * **2. フレームの処理そのものから外へ出す。** 例外を止めるだけでは足りない ――
 * 音を組むのに時間がかかれば、そのぶんフレームが延びて、やはり操作が鈍る。
 * 呼ばれた時点では予約だけして、実際の組み立ては**そのフレームの処理が終わってから**
 * 走らせる。マイクロタスクなので同じ「仕事」の中に留まり、ブラウザの
 * 「操作があるまで鳴らせない」判定（ユーザー操作の資格）も失わない。
 *
 * ただし `resume` だけは別で、その場で走らせる。AudioContext を作って動かすのは
 * 操作の直後でなければ断られることがあるため。戻り値を使うもの（`toggle*`）も同じ。
 */
const SYNC = new Set(['resume', 'toggleMute', 'toggleBgm']);

function guarded<T extends object>(target: T): T {
  let dead = false;
  const fail = (key: string | symbol, err: unknown): void => {
    dead = true;
    note(`音を用意できませんでした（${String(key)}）。以後は音なしで続けます。\n  ${String(err)}`);
    console.error(err);
  };
  return new Proxy(target, {
    get(obj, key, recv) {
      const v = Reflect.get(obj, key, recv);
      if (typeof v !== 'function') return v;
      const fn = v as (...a: unknown[]) => unknown;
      if (SYNC.has(key as string)) {
        return (...args: unknown[]): unknown => {
          if (dead) return undefined;
          try {
            return fn.apply(obj, args);
          } catch (err) {
            fail(key, err);
            return undefined;
          }
        };
      }
      return (...args: unknown[]): undefined => {
        if (dead) return undefined;
        queueMicrotask(() => {
          if (dead) return;
          try {
            fn.apply(obj, args);
          } catch (err) {
            fail(key, err);
          }
        });
        return undefined;
      };
    },
  });
}

/**
 * 音は画面をまたいで1つだけ持つ。
 * 画面ごとに作ると AudioContext が増え、BGM が二重に鳴ったり、
 * タイトルで鳴らしはじめた曲が対戦に移った瞬間に止まったりする
 */
export const sfx = guarded(new Sfx());

/** プロペラのチョップ感を AM で作るエンジン音 */
class EngineVoice {
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

export type BgmKind = 'menu' | 'battle';

/**
 * 曲の土台。決まった長さの「手」を並べていく仕掛けだけを持つ。
 * 何を鳴らすかは継承先が書く。
 *
 * 先の分まで前倒しで予約するのは、setTimeout の精度では拍が揺れるため ――
 * 鳴らす時刻は AudioContext の時計で決め、予約だけをタイマーで回す
 */
abstract class Track {
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
class BattleBgm extends Track {
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
class MenuBgm extends Track {
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
