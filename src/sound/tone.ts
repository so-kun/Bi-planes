/**
 * 音の部品のうち、どの音でも使うもの。
 *
 * 効果音・エンジン音・BGM はそれぞれ別のファイルに分けてあり
 * （`engine.ts` / `bgm.ts` / まとめ役の `src/audio.ts`）、
 * 共通で要るのはここに置いた素と、タイマーの受け止めだけ。
 */

import { note } from '../diagnostics';

export type Ctx = AudioContext;

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

export function noiseBuffer(ac: Ctx): AudioBuffer {
  const hit = noiseBuffers.get(ac);
  if (hit) return hit;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * NOISE_SEC), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ac, buf);
  return buf;
}

/** 雑音を読み出しはじめる場所。dur 秒ぶん読み切れる範囲で毎回ずらす */
export function noiseFrom(dur: number): number {
  return Math.random() * Math.max(0, NOISE_SEC - dur);
}

/**
 * タイマーで回す音の処理を包む。
 *
 * タイマーはゲームの輪とは別に動くので、ここで例外が出ても画面は止まらない。
 * ただし黙って壊れ続けるのは困るので、一度失敗したらそのタイマーだけを閉じ、
 * 何が起きたかを画面に出す
 */
export function onTimer(what: string, fn: () => void): () => void {
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

