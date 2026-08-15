/**
 * 機体の状態をエンジン音へ流す係。
 *
 * **画面ごとに書かない。** もとは対戦の画面だけが持っていて、タイムアタックは
 * 立ち上がりに巡航で鳴らしたきり一度も更新していなかった ――
 * 全開にしても音が変わらず、水温が赤帯に入っても荒れなかった。
 * 同じことを二度書けば、片方だけ古いまま残る。
 *
 * 変わったときだけ鳴らし直す。水温は 5 段に丸めてから見る ――
 * 毎フレーム渡すと、荒れ方を作っているタイマーを組み直してしまう。
 */

import { sfx } from '../audio';
import type { Plane } from '../objects/Plane';

/** 損傷した音に切り替える体力 */
const DAMAGED_HP = 70;
/** 水温の踏み込み具合を何段に丸めるか */
const STRAIN_STEPS = 5;

export class EngineSound {
  /** 前に鳴らした状態。同じなら何もしない */
  private last = '';

  /** @param index 機体の番号。1P = 0、2P = 1 */
  constructor(private index: number) {}

  /** 機体の今の状態を流す。毎フレーム呼んでよい */
  follow(plane: Plane): void {
    const damaged = plane.hp < DAMAGED_HP;
    const strain = Math.round(plane.strain * STRAIN_STEPS) / STRAIN_STEPS;
    const key = `${plane.state.throttle}/${damaged}/${strain}`;
    if (key === this.last) return;
    this.last = key;
    // EngineVoice の段階は 1..3。巡航を 2、全開を 3 に対応させる
    sfx.setEngine(this.index, plane.state.throttle + 2, damaged, strain);
  }

  /** 空にいない機の音を絞る（撃墜・一時停止）。戻ったときは鳴らし直す */
  idle(): void {
    sfx.setEngine(this.index, 1, false);
    this.last = '';
  }

  /**
   * 控えだけ消す。次の `follow` で必ず鳴らし直す ――
   * 機体を出撃位置に戻したときなど、音のほうは変わっていなくても
   * 鳴らし直しておかないと、直前の荒れた音が残る
   */
  forget(): void {
    this.last = '';
  }
}
