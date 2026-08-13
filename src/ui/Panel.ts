/**
 * 計器盤。得点・体力・スロットルを、真鍮枠の一枚板にまとめて出す。
 *
 * 意匠はユーザー提供の参考図どおり ―― 濃紺の板に真鍮の縁と鋲、
 * クリーム色の銘板、走行距離計のような数字の窓、区切りのある体力の帯、
 * 右端に丸い計器。
 *
 * 枠や銘板は動かないので**一度だけ描く**。毎フレーム描き直すのは
 * 数字・体力の目盛り・針・残弾だけにしてある。
 */

import Phaser from 'phaser';
import { PLANE, WEAPON } from '../config';

/** 板の大きさ */
export const PANEL = { w: 340, h: 104 };

/** 色。参考図から採った */
const C = {
  plate: 0x27313d,          // 濃紺の地
  plateWorn: 0x36414e,      // 塗りの剥げ
  brass: 0xb9913c,
  brassHi: 0xe0c078,
  brassLo: 0x6b5324,
  copper: 0xa97248,
  cream: 0xe9dfc2,
  ink: 0x2b2419,
  window: 0x14100b,         // 数字の窓の奥
  dark: 0x1b1b1b,           // 消えている目盛り
};

/** 体力の帯。左から赤 → 橙 → 黄。減ると右から消え、最後に赤だけが残る */
const HEALTH_STEPS = [0xb8392a, 0xc04a26, 0xd06322, 0xd97b24, 0xdf922a, 0xe0a52f, 0xd8b134, 0xcfba3c];

/** 見た目の状態。呼ぶ側はこれだけ渡す */
export interface PanelState {
  score: number;
  /** 勝ちに必要な点。フリープレイでは null（上限を出さない） */
  target: number | null;
  hp: number;
  cannonAmmo: number;
  /** 0 = 巡航、1 = 全開 */
  throttle: number;
}

/** 種を決めた擬似乱数。塗りの剥げが毎回同じ場所に出るようにする */
function rng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

export class Panel {
  private still: Phaser.GameObjects.Graphics;
  private live: Phaser.GameObjects.Graphics;
  private digits: Phaser.GameObjects.Text;
  private targetText: Phaser.GameObjects.Text;
  private nameText: Phaser.GameObjects.Text;
  /** 銘板に彫った文字。まとめて隠せるように持っておく */
  private labels: Phaser.GameObjects.Text[] = [];
  /** 針は目標へ滑らかに寄せる。跳ねると機械らしくない */
  private needle = 0;

  /** 板の中の置き場所。左上を原点にした座標 */
  private static readonly L = {
    inset: 6,
    scorePlate: { x: 14, y: 10, w: 100, h: 19 },
    window: { x: 12, y: 34, w: 116, h: 42 },
    ammo: { x: 18, y: 80, gap: 16, w: 10, h: 14 },
    healthPlate: { x: 140, y: 10, w: 112, h: 19 },
    shield: { x: 134, y: 38, w: 26, h: 36 },
    bar: { x: 168, y: 42, w: 98, h: 28 },
    gauge: { cx: 294, cy: 52, r: 37 },
  };

  constructor(
    private scene: Phaser.Scene,
    private x: number,
    private y: number,
    private color: number,
    name: string,
    depth = 70,
  ) {
    this.still = scene.add.graphics().setDepth(depth);
    this.live = scene.add.graphics().setDepth(depth + 1);
    const L = Panel.L;

    this.digits = scene.add.text(x + L.window.x + L.window.w * 0.42, y + L.window.y + L.window.h / 2, '000', {
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '28px', color: '#efe2b8',
    }).setOrigin(0.5).setDepth(depth + 2);
    // 上限は窓の隅に小さく添えるだけ。見るべき数字はひとつに絞る
    this.targetText = scene.add.text(x + L.window.x + L.window.w - 6, y + L.window.y + L.window.h - 5, '', {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#8d7a52',
    }).setOrigin(1, 1).setDepth(depth + 2);
    this.nameText = scene.add.text(x + L.shield.x + L.shield.w / 2, y + L.shield.y + L.shield.h / 2 + 1, name, {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#fbf2d8',
    }).setOrigin(0.5).setDepth(depth + 2);

    this.drawStill();
  }

  // ---------------------------------------------------------------- 動かない部分

  private drawStill(): void {
    const g = this.still;
    const { x, y } = this;
    const L = Panel.L;
    g.clear();

    // 真鍮の外枠 → 濃紺の地
    g.fillStyle(C.brassLo, 1);
    g.fillRoundedRect(x, y, PANEL.w, PANEL.h, 15);
    g.fillStyle(C.brass, 1);
    g.fillRoundedRect(x + 2, y + 2, PANEL.w - 4, PANEL.h - 4, 13);
    g.fillStyle(C.plate, 1);
    g.fillRoundedRect(x + L.inset, y + L.inset, PANEL.w - L.inset * 2, PANEL.h - L.inset * 2, 10);
    // 縁の内側に明るい線を一本。真鍮の面取りに見える
    g.lineStyle(1.5, C.brassHi, 0.55);
    g.strokeRoundedRect(x + 3.5, y + 3.5, PANEL.w - 7, PANEL.h - 7, 12);

    this.drawWear();

    // 上下の帯金（銅）。参考図と同じく、板を留めている風にする。
    // 下側は残弾に重ならない位置へずらす
    for (const [bx, by] of [[0.3, 0], [0.72, 0], [0.56, 1], [0.84, 1]] as [number, number][]) {
      {
        const px = x + PANEL.w * bx - 13;
        const py = by ? y + PANEL.h - 16 : y;
        g.fillStyle(C.copper, 1);
        g.fillRoundedRect(px, py, 26, 16, 3);
        g.lineStyle(1.2, C.brassLo, 0.9);
        g.strokeRoundedRect(px, py, 26, 16, 3);
        g.fillStyle(C.brassHi, 0.9);
        g.fillCircle(px + 13, py + 8, 2.4);
      }
    }

    // 四隅のねじ
    for (const [sx, sy] of [[16, 16], [PANEL.w - 16, 16], [16, PANEL.h - 16], [PANEL.w - 16, PANEL.h - 16]]) {
      this.screw(g, x + sx, y + sy);
    }

    this.plate(g, x + L.scorePlate.x, y + L.scorePlate.y, L.scorePlate.w, L.scorePlate.h, 'SCORE');
    this.plate(g, x + L.healthPlate.x, y + L.healthPlate.y, L.healthPlate.w, L.healthPlate.h, 'HEALTH');

    // 数字の窓。奥を暗くして、真鍮の枠を回す
    const w = L.window;
    g.fillStyle(C.brass, 1);
    g.fillRoundedRect(x + w.x - 4, y + w.y - 4, w.w + 8, w.h + 8, 5);
    g.fillStyle(C.brassLo, 1);
    g.fillRoundedRect(x + w.x - 2, y + w.y - 2, w.w + 4, w.h + 4, 4);
    g.fillStyle(C.window, 1);
    g.fillRoundedRect(x + w.x, y + w.y, w.w, w.h, 3);
    // 桁の仕切り
    g.lineStyle(1.2, 0x3a3226, 0.9);
    for (let i = 1; i < 3; i++) {
      g.lineBetween(x + w.x + w.w * i / 3, y + w.y + 3, x + w.x + w.w * i / 3, y + w.y + w.h - 3);
    }

    // 体力の帯の受け皿
    const b = L.bar;
    g.fillStyle(C.brass, 1);
    g.fillRoundedRect(x + b.x - 5, y + b.y - 5, b.w + 10, b.h + 10, 5);
    g.fillStyle(C.brassLo, 1);
    g.fillRoundedRect(x + b.x - 3, y + b.y - 3, b.w + 6, b.h + 6, 4);
    g.fillStyle(C.window, 1);
    g.fillRect(x + b.x, y + b.y, b.w, b.h);

    // 20mm の受け皿。掘り込んでおかないと弾が地の色に紛れる
    const a = L.ammo;
    const trayW = WEAPON.cannon.ammo * a.gap + 6;
    g.fillStyle(C.brassLo, 1);
    g.fillRoundedRect(x + a.x - 6, y + a.y - 4, trayW + 4, a.h + 8, 4);
    g.fillStyle(C.window, 1);
    g.fillRoundedRect(x + a.x - 4, y + a.y - 2, trayW, a.h + 4, 3);
    this.labels.push(this.scene.add.text(x + a.x + trayW + 4, y + a.y + a.h / 2, '20mm', {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#8d7a52',
    }).setOrigin(0, 0.5).setDepth(this.still.depth + 1));

    this.drawShield(g);
    this.drawGaugeFace(g);
  }

  /** 塗りの剥げ。同じ場所に出るよう、種を決めた乱数で散らす */
  private drawWear(): void {
    const g = this.still;
    const rand = rng(1234 + this.x);
    g.fillStyle(C.plateWorn, 0.5);
    for (let i = 0; i < 90; i++) {
      const px = this.x + 8 + rand() * (PANEL.w - 16);
      const py = this.y + 8 + rand() * (PANEL.h - 16);
      g.fillRect(px, py, 1 + rand() * 7, 1 + rand() * 1.5);
    }
    g.fillStyle(C.brass, 0.28);
    for (let i = 0; i < 26; i++) {
      const px = this.x + 6 + rand() * (PANEL.w - 12);
      const py = this.y + (rand() < 0.5 ? 7 + rand() * 4 : PANEL.h - 11 - rand() * 4);
      g.fillRect(px, py, 3 + rand() * 12, 1.4);
    }
  }

  private screw(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    g.fillStyle(C.brassLo, 1);
    g.fillCircle(cx, cy, 7);
    g.fillStyle(C.brass, 1);
    g.fillCircle(cx, cy, 5.6);
    g.lineStyle(1.6, C.brassLo, 1);
    g.lineBetween(cx - 4, cy - 2.4, cx + 4, cy + 2.4);
  }

  /** クリーム色の銘板。文字は彫ってあるように暗く */
  private plate(g: Phaser.GameObjects.Graphics, px: number, py: number, w: number, h: number, label: string): void {
    g.fillStyle(C.brassLo, 1);
    g.fillRoundedRect(px - 2, py - 2, w + 4, h + 4, 5);
    g.fillStyle(C.cream, 1);
    g.fillRoundedRect(px, py, w, h, 4);
    g.fillStyle(C.brassLo, 1);
    g.fillCircle(px + 7, py + h / 2, 1.8);
    g.fillCircle(px + w - 7, py + h / 2, 1.8);
    this.labels.push(this.scene.add.text(px + w / 2, py + h / 2, label, {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '13px', color: '#2b2419',
    }).setOrigin(0.5).setDepth(this.still.depth + 1).setLetterSpacing(2));
  }

  /** 体力の帯の左に立てる盾。持ち主の色を入れて 1P / 2P を見分ける */
  private drawShield(g: Phaser.GameObjects.Graphics): void {
    const s = Panel.L.shield;
    const px = this.x + s.x, py = this.y + s.y;
    const path = [
      [px, py + 4], [px + 4, py], [px + s.w - 4, py], [px + s.w, py + 4],
      [px + s.w, py + s.h * 0.55], [px + s.w / 2, py + s.h], [px, py + s.h * 0.55],
    ];
    g.fillStyle(C.brass, 1);
    g.fillPoints(path.map(([a, b]) => new Phaser.Geom.Point(a, b)), true);
    g.lineStyle(1.5, C.brassLo, 1);
    g.strokePoints(path.map(([a, b]) => new Phaser.Geom.Point(a, b)), true);
    g.fillStyle(this.color, 1);
    g.fillPoints(path.map(([a, b]) => new Phaser.Geom.Point(
      px + (a - px) * 0.74 + s.w * 0.13, py + (b - py) * 0.74 + s.h * 0.1,
    )), true);
  }

  /** 丸い計器の文字盤。針は毎フレーム描き直すので、ここは目盛りまで */
  private drawGaugeFace(g: Phaser.GameObjects.Graphics): void {
    const { cx, cy, r } = Panel.L.gauge;
    const x = this.x + cx, y = this.y + cy;
    g.fillStyle(C.brassLo, 1); g.fillCircle(x, y, r);
    g.fillStyle(C.brass, 1); g.fillCircle(x, y, r - 3);
    g.fillStyle(C.brassHi, 0.5); g.fillCircle(x, y, r - 5);
    g.fillStyle(C.cream, 1); g.fillCircle(x, y, r - 7);

    // 帯（緑 → 黄 → 赤）。スロットルを開けるほど右へ振れる
    const A0 = Math.PI * 0.78, A1 = Math.PI * 2.22;
    const band: [number, number, number][] = [[0, 0.45, 0x6f8f6a], [0.45, 0.75, 0xd4a52c], [0.75, 1, 0xb8392a]];
    for (const [f0, f1, col] of band) {
      g.lineStyle(5, col, 0.9);
      g.beginPath();
      g.arc(x, y, r - 11, A0 + (A1 - A0) * f0, A0 + (A1 - A0) * f1, false);
      g.strokePath();
    }
    // 目盛り
    for (let i = 0; i <= 10; i++) {
      const a = A0 + (A1 - A0) * (i / 10);
      const long = i % 5 === 0;
      g.lineStyle(long ? 2 : 1, C.ink, long ? 0.9 : 0.55);
      g.lineBetween(x + Math.cos(a) * (r - 14), y + Math.sin(a) * (r - 14),
        x + Math.cos(a) * (r - (long ? 21 : 18)), y + Math.sin(a) * (r - (long ? 21 : 18)));
    }
    this.labels.push(this.scene.add.text(x, y + r - 18, 'THR', {
      fontFamily: 'Georgia, serif', fontSize: '9px', color: '#6b5b3e',
    }).setOrigin(0.5).setDepth(this.still.depth + 1).setLetterSpacing(1));
  }

  // ---------------------------------------------------------------- 動く部分

  update(s: PanelState, dt: number): void {
    const g = this.live;
    const { x, y } = this;
    const L = Panel.L;
    g.clear();

    // 数字。走行距離計らしく、頭を 0 で埋める
    this.digits.setText(String(Math.max(0, Math.min(999, s.score))).padStart(3, '0'));
    this.targetText.setText(s.target === null ? '' : `/ ${s.target}`);

    // 体力の目盛り
    const b = L.bar;
    const lit = Math.ceil(Phaser.Math.Clamp(s.hp / PLANE.maxHp, 0, 1) * HEALTH_STEPS.length);
    const seg = (b.w - (HEALTH_STEPS.length - 1) * 2) / HEALTH_STEPS.length;
    for (let i = 0; i < HEALTH_STEPS.length; i++) {
      const sx = x + b.x + i * (seg + 2);
      g.fillStyle(i < lit ? HEALTH_STEPS[i] : C.dark, 1);
      g.fillRect(sx, y + b.y + 2, seg, b.h - 4);
      if (i < lit) {
        // 上端に細いつやを入れると、塗りが立体に見える
        g.fillStyle(0xffffff, 0.16);
        g.fillRect(sx, y + b.y + 2, seg, 3);
      } else {
        // 消えていても一つずつ数えられるよう、区切りを薄く残す
        g.fillStyle(0x3b3b3b, 1);
        g.fillRect(sx + seg, y + b.y + 2, 2, b.h - 4);
      }
    }

    // 20mm の残弾。真鍮の弾を並べ、撃つと沈んで暗くなる
    const a = L.ammo;
    for (let i = 0; i < WEAPON.cannon.ammo; i++) {
      const live = i < s.cannonAmmo;
      const px = x + a.x + i * a.gap;
      const py = y + a.y + (live ? 0 : 3);
      g.fillStyle(live ? C.brass : 0x3a3222, 1);
      g.fillRoundedRect(px, py, a.w, live ? a.h : a.h - 3, 2);
      if (live) {
        // 弾頭と、真鍮のつや
        g.fillStyle(C.brassHi, 0.95);
        g.fillTriangle(px, py + 4, px + a.w / 2, py - 3, px + a.w, py + 4);
        g.fillStyle(C.brassHi, 0.5);
        g.fillRect(px + 1.5, py + 4, 2, a.h - 5);
      }
    }

    // 針。目標へ滑らかに寄せる
    const want = s.throttle > 0 ? 1 : 0.32;
    this.needle += (want - this.needle) * Math.min(1, dt * 9);
    const { cx, cy, r } = L.gauge;
    const A0 = Math.PI * 0.78, A1 = Math.PI * 2.22;
    const na = A0 + (A1 - A0) * this.needle;
    const gx = x + cx, gy = y + cy;
    g.lineStyle(2.6, C.ink, 1);
    g.lineBetween(gx - Math.cos(na) * 6, gy - Math.sin(na) * 6,
      gx + Math.cos(na) * (r - 13), gy + Math.sin(na) * (r - 13));
    g.fillStyle(C.ink, 1); g.fillCircle(gx, gy, 4);
    g.fillStyle(C.brassHi, 1); g.fillCircle(gx - 1, gy - 1, 1.6);
  }

  setVisible(on: boolean): void {
    this.still.setVisible(on);
    this.live.setVisible(on);
    this.digits.setVisible(on);
    this.targetText.setVisible(on);
    this.nameText.setVisible(on);
    for (const t of this.labels) t.setVisible(on);
  }
}
