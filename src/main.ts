import Phaser from 'phaser';
import { VIEW } from './config';
import { sfx } from './audio';
import { loadSettings, settings } from './settings';
import { installDiagnostics } from './diagnostics';
import { BootScene } from './scenes/BootScene';
import { OpeningScene } from './scenes/OpeningScene';
import { TitleScene } from './scenes/TitleScene';
import { OptionsScene } from './scenes/OptionsScene';
import { PlayScene } from './scenes/PlayScene';
import { PracticeScene } from './scenes/PracticeScene';

// 保存してある設定を、画面が立ち上がる前に読む。
// あとから読むと、既定の値で作られた画面が残ってしまう
loadSettings();

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
  scene: [BootScene, OpeningScene, TitleScene, OptionsScene, PlayScene, PracticeScene],
});

// 落ち方を見えるようにする。描画の輪も止まらないように包む
installDiagnostics(game);

// プレイテスト中に値を覗けるようにしておく。
// sfx と settings も出しておくと、ブラウザを立ち上げた自動確認から
// 音の状態や、保存を読んだあとに実際に効いている設定を測れる
const peek = window as unknown as {
  game: Phaser.Game; sfx: typeof sfx; settings: typeof settings;
};
peek.game = game;
peek.sfx = sfx;
peek.settings = settings;
