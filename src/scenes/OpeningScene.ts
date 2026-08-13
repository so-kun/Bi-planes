/**
 * オープニング。いただいた完成図（opening-title.png）をそのまま出す。
 *
 * はじめは背景・ロゴ・機体を切り抜いて組み直していたが、完成図の絵が
 * そのまま使えるので、そちらを一枚で出している。絵に描かれている
 * "PRESS START" だけは消してあり（tools/cutout.py）、代わりに
 * ここで明滅する文字を出す。
 *
 * ここは見せるだけの画面。何か押されたらステージ選択へ移る。
 */

import Phaser from 'phaser';
import { VIEW, FILM_DEFAULT } from '../config';
import { sfx } from '../audio';
import { FilmPipeline } from '../fx/FilmPipeline';
import { PadInput } from '../input/PadInput';

/** 完成図では "PRESS START" がこの高さにあった。同じ所に出す */
const PROMPT_Y = VIEW.height - 68;

export class OpeningScene extends Phaser.Scene {
  private prompt!: Phaser.GameObjects.Text;
  private pad = new PadInput(0);
  private started = false;
  private t = 0;

  constructor() {
    super('Opening');
  }

  create(): void {
    // 画面を作り直しても構築子は呼ばれないので、ここで戻す
    this.started = false;
    this.t = 0;

    const bg = this.add.image(0, 0, 'title-art').setOrigin(0);
    bg.setDisplaySize(VIEW.width, VIEW.height);

    this.prompt = this.add.text(VIEW.width / 2, PROMPT_Y,
      'PRESS A BUTTON OR ENTER KEY', {
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '30px', color: '#f4e6c8',
        stroke: '#241a12', strokeThickness: 6,
      }).setOrigin(0.5).setDepth(10);

    this.setupInput();
    this.setupFilm();
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    // どのキーでも先へ進む。押すものを探させない
    kb.on('keydown', () => this.start());
    this.input.on('pointerdown', () => this.start());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { kb.removeAllListeners('keydown'); });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    sfx.resume();
    sfx.beep(true);
    this.scene.start('Title');
  }

  override update(_time: number, delta: number): void {
    this.t += Math.min(0.05, delta / 1000);
    // 「押してください」はゆっくり明滅させる。動きがないと止まって見える
    this.prompt.setAlpha(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 3.2)));

    const s = this.pad.read();
    if (s.connected && (s.mg || s.cannonEdge || s.throttle || s.rollEdge !== 0)) this.start();
  }

  private setupFilm(): void {
    const renderer = this.game.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    if (!renderer.pipelines.has('Film')) renderer.pipelines.addPostPipeline('Film', FilmPipeline);
    this.cameras.main.setPostPipeline(FilmPipeline);
    (this.cameras.main.getPostPipeline(FilmPipeline) as FilmPipeline)?.setLevel(FILM_DEFAULT);
  }
}
