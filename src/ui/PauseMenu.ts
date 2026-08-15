/**
 * 一時停止の確認。
 *
 * ＋（Start）や Esc は、押した瞬間にタイトルへ戻る作りだった。
 * 飛んでいる最中に押し間違えると試合がそこで消えてしまうので、**一度止めて聞き直す**。
 *
 * カーソルの初めの位置は「つづける」側。押し間違えたときに、
 * もう一度同じボタンを押すだけで戻れるようにするため。
 *
 * ここは表示と選択だけを持つ。何を止めるか（機体・弾・音）は呼ぶ側の仕事
 * ―― 対戦とタイムアタックで止めるものが違うので、そちらに任せる。
 */

import Phaser from 'phaser';
import { VIEW } from '../config';

const CREAM = '#f4e6c8';
const GOLD = '#ffd76b';
const INK = '#241a12';

/** 選んだもの */
export type PauseChoice = 'continue' | 'quit';

const ITEMS: { label: string; choice: PauseChoice }[] = [
  { label: 'いいえ、つづける', choice: 'continue' },
  { label: 'はい、タイトルへもどる', choice: 'quit' },
];

const TOP = VIEW.height / 2 + 4;
const STEP = 44;

export class PauseMenu {
  private layer: Phaser.GameObjects.Container;
  private items: Phaser.GameObjects.Text[] = [];
  private cursor: Phaser.GameObjects.Text;
  private index = 0;

  constructor(scene: Phaser.Scene) {
    const shade = scene.add.rectangle(0, 0, VIEW.width, VIEW.height, 0x0d0906, 0.62).setOrigin(0);
    const card = scene.add.rectangle(VIEW.width / 2, VIEW.height / 2, 560, 300, 0x181008, 0.9)
      .setStrokeStyle(1, 0xf4e6c8, 0.4);

    const pause = scene.add.text(VIEW.width / 2, VIEW.height / 2 - 108, '一 時 停 止', {
      fontFamily: 'Georgia, serif', fontSize: '17px', color: GOLD,
    }).setOrigin(0.5);

    const ask = scene.add.text(VIEW.width / 2, VIEW.height / 2 - 62, 'ゲームを終了しますか？', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '34px', color: CREAM,
      stroke: INK, strokeThickness: 6,
    }).setOrigin(0.5);

    this.items = ITEMS.map((item, i) => scene.add.text(VIEW.width / 2, TOP + i * STEP, item.label, {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '26px', color: CREAM,
      stroke: INK, strokeThickness: 5,
    }).setOrigin(0.5));

    this.cursor = scene.add.text(0, TOP, '▶', {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#e8836a',
      stroke: INK, strokeThickness: 4,
    }).setOrigin(0.5);

    const keys = scene.add.text(VIEW.width / 2, VIEW.height / 2 + 112,
      '↑ ↓ 選ぶ　　Enter / ○A 決定　　Esc / ×B / ＋ つづける', {
        fontFamily: 'Georgia, serif', fontSize: '15px', color: CREAM,
        backgroundColor: 'rgba(24,16,10,0.5)', padding: { x: 12, y: 4 },
      }).setOrigin(0.5).setAlpha(0.85);

    this.layer = scene.add.container(0, 0, [shade, card, pause, ask, ...this.items, this.cursor, keys]);
    this.layer.setDepth(90).setVisible(false);
  }

  get open(): boolean { return this.layer.visible; }

  show(): void {
    this.index = 0;
    this.layer.setVisible(true);
    this.refresh();
  }

  hide(): void {
    this.layer.setVisible(false);
  }

  move(d: -1 | 1): void {
    this.index = (this.index + d + ITEMS.length) % ITEMS.length;
    this.refresh();
  }

  /** いま合わせているもの */
  get choice(): PauseChoice { return ITEMS[this.index].choice; }

  private refresh(): void {
    this.items.forEach((t, i) => {
      const on = i === this.index;
      t.setColor(on ? GOLD : CREAM);
      t.setAlpha(on ? 1 : 0.6);
    });
    const here = this.items[this.index];
    this.cursor.setPosition(here.x - here.width / 2 - 26, here.y);
  }
}
