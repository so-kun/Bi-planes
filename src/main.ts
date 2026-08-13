import Phaser from 'phaser';
import { VIEW } from './config';
import { sfx } from './audio';
import { installDiagnostics } from './diagnostics';
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
  // Phaser の音は使わない（音はすべて src/audio.ts で自前に合成している）。
  // 切っておかないと Phaser が起動時に AudioContext をもう一つ作り、
  // ブラウザ側の「操作があるまで鳴らせない」仕掛けと二重に噛み合う。
  // Safari は同時に持てる AudioContext の数が少ないので、無駄には持たない
  audio: { noAudio: true },
  scene: [BootScene, OpeningScene, TitleScene, PlayScene, PracticeScene],
});

// 落ち方を見えるようにする。描画の輪も止まらないように包む
installDiagnostics(game);

// プレイテスト中に値を覗けるようにしておく。
// sfx も出しておくと、ブラウザを立ち上げた自動確認から音の状態を測れる
(window as unknown as { game: Phaser.Game; sfx: typeof sfx }).game = game;
(window as unknown as { sfx: typeof sfx }).sfx = sfx;
