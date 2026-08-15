/**
 * 効果音と BGM のまとめ役。すべて Web Audio でその場で合成する。音源ファイルは持たない。
 * 方向性は samples/art-sound-sample.html で採用済み。
 *
 * 音の部品は `src/sound/` に分けてある ―― 素と入れ物（tone）、エンジン音（engine）、曲（bgm）。
 * ここが持つのは、それらをつなぐ配線と、外から呼ばれる窓口だけ。
 */

import { AUDIO } from './config';
import { note } from './diagnostics';
import { settings, saveSettings } from './settings';
import { noiseBuffer, noiseFrom, type Ctx } from './sound/tone';
import { EngineVoice } from './sound/engine';
import { BattleBgm, MenuBgm, type BgmKind, type Track } from './sound/bgm';

export type { BgmKind };

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
  /**
   * 水温の踏み込み具合（0 = 赤帯の手前、1 = 振り切れ）。
   * 入切の2値ではなく度合いで持つ ―― 赤帯に入った瞬間だけ変わって、
   * あとは同じだと「まずい」と気づけないため
   */
  private engineStrain: number[] = [];
  private bgm: Track | null = null;
  /** 今どの曲を鳴らしたいか。B キーで切っても、次の画面で戻せるように覚えておく */
  private bgmKind: BgmKind = 'battle';
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
      master.gain.value = settings.volume;
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

  /** オプション画面で音量を変えたときに呼ぶ。鳴っている最中でもすぐ効く */
  applyVolume(): void {
    if (this.ac && !this.muted) this.master.gain.value = settings.volume;
  }

  /**
   * オプション画面で BGM の入切を変えたときに呼ぶ。
   *
   * 入切の**持ち主は `settings.bgm` ひとつだけ**にしてある。
   * ここで写しを持つと、写しを作る時期（この class ができるとき）が
   * 保存を読む時期（`loadSettings()`）より早いため、
   * 「切」で保存してあっても入のまま立ち上がってしまう
   */
  applyBgmSetting(): void {
    if (settings.bgm) this.playBgm(this.bgmKind);
    else this.stopBgm();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ac) this.master.gain.value = this.muted ? 0 : settings.volume;
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
        this.ac, this.engineBus, noiseBuffer(this.ac),
        this.engineLevel[i] ?? 2, this.engineDamaged[i] ?? false, this.engineStrain[i] ?? 0,
      );
    }
    this.balanceEngines();
  }

  /** @param strain 水温の踏み込み具合（0 = 赤帯の手前、1 = 振り切れ） */
  setEngine(index: number, level: number, damaged: boolean, strain = 0): void {
    this.engineLevel[index] = level;
    this.engineDamaged[index] = damaged;
    this.engineStrain[index] = strain;
    this.engines[index]?.set(level, damaged, strain);
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
    if (!this.ac || !settings.bgm) return;
    if (this.bgm && this.bgm.kind === kind) return;
    this.bgm?.stop();
    this.bgm = kind === 'menu' ? new MenuBgm(this.ac, this.musicBus) : new BattleBgm(this.ac, this.musicBus);
    this.bgm.start();
  }

  /**
   * 曲を一時的に絞る。一時停止の間に使う ――
   * 止めてしまうと戻ったときに頭から鳴り直すので、小さくするだけにする
   */
  duck(on: boolean): void {
    if (!this.ac) return;
    this.musicBus.gain.setTargetAtTime(AUDIO.music * (on ? 0.35 : 1), this.ac.currentTime, 0.12);
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
      settings.bgm = false;
      saveSettings();
      this.stopBgm();
      return false;
    }
    settings.bgm = true;
    saveSettings();
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

