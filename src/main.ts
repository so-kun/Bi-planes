import Phaser from 'phaser';
import { VIEW } from './config';
import { sfx } from './audio';
import { BootScene } from './scenes/BootScene';
import { OpeningScene } from './scenes/OpeningScene';
import { TitleScene } from './scenes/TitleScene';
import { PlayScene } from './scenes/PlayScene';
import { PracticeScene } from './scenes/PracticeScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.width,
  height: VIEW.height,
  backgroundColor: '#17110c',
  // 論理解像度は固定し、表示だけ画面に合わせて拡縮する
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  scene: [BootScene, OpeningScene, TitleScene, PlayScene, PracticeScene],
});

// プレイテスト中に値を覗けるようにしておく。
// sfx も出しておくと、ブラウザを立ち上げた自動確認から音の状態を測れる
(window as unknown as { game: Phaser.Game; sfx: typeof sfx }).game = game;
(window as unknown as { sfx: typeof sfx }).sfx = sfx;
