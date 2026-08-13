import Phaser from 'phaser';

/**
 * 不具合を「見える」ようにする仕掛け。
 *
 * ブラウザによっては、こちらで再現できない止まり方をする。原因を当てずっぽうで
 * 探すより、起きたことを画面に出して読んでもらうほうが早い。
 *
 * やっていることは2つ:
 *
 * 1. **描画の輪を落とさない。** Phaser の毎フレームの呼び出しは
 *    `callback(time)` を呼んでから次のフレームを予約する（`RequestAnimationFrame.step`）。
 *    途中で例外が出ると次の予約に届かず、輪がそこで止まる ―― 絵は最後のコマのまま残るので、
 *    見た目には「キーが効かなくなった」ように映る。ここで受け止めれば輪は回り続ける
 * 2. **出た例外と、こちらからの但し書きを画面に出す。** キャンバスの外の普通の DOM に
 *    出すので、輪が止まっていても読める
 * 3. **輪が回っているかを、輪の外から見張る。** 「操作を受け付けない」という症状は、
 *    絵が止まっているのか、絵は動いているのに入力だけ通らないのかで原因がまるで違う。
 *    setInterval は輪とは別に動くので、止まったこと自体を知らせられる
 */

const MAX_LINES = 4;

let box: HTMLDivElement | null = null;
const shown = new Set<string>();

function ensureBox(): HTMLDivElement {
  if (box) return box;
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9999',
    'font:13px/1.6 Georgia, serif', 'color:#f4e6c8', 'background:rgba(24,16,10,0.92)',
    'padding:8px 14px', 'white-space:pre-wrap', 'cursor:pointer',
    'border-top:2px solid #a8402c',
  ].join(';');
  el.title = 'クリックで消す';
  el.addEventListener('click', () => { el.textContent = ''; el.style.display = 'none'; });
  document.body.appendChild(el);
  box = el;
  return el;
}

/** 画面に一行出す。同じ文言は一度だけ */
export function note(text: string): void {
  if (shown.has(text)) return;
  shown.add(text);
  const el = ensureBox();
  el.style.display = 'block';
  const lines = el.textContent ? el.textContent.split('\n') : [];
  lines.push(text);
  el.textContent = lines.slice(-MAX_LINES).join('\n');
  console.warn('[Bi-Planes]', text);
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const where = err.stack?.split('\n')[1]?.trim() ?? '';
    return `${err.name}: ${err.message}${where ? `\n  （${where}）` : ''}`;
  }
  return String(err);
}

const guarded = new WeakSet<object>();
let loopFailures = 0;

/**
 * Phaser の毎フレームの呼び出しを包んで、例外が出ても輪を止めないようにする。
 *
 * **毎フレーム掛け直す**必要がある。Phaser は `raf.callback` に入れた関数を
 * 差し替えることがあるため ―― 起動のときはもちろん（`ready` が出るのは
 * 輪が始まる**前**なので、そこで包んでも直後に上書きされる）、
 * 画面から目を離して戻ったとき（`TimeStep.wake`）にも入れ直される。
 * 一度だけ包む書き方だと、包みが黙って外れたまま気づけない
 */
function guardLoop(game: Phaser.Game): void {
  const raf = (game.loop as unknown as { raf?: { callback: (t: number) => void } }).raf;
  if (!raf || typeof raf.callback !== 'function' || guarded.has(raf.callback)) return;
  const step = raf.callback;
  const wrapped = (time: number): void => {
    try {
      step(time);
    } catch (err) {
      loopFailures++;
      note(`描画中にエラーが出ました（${loopFailures} 回目・${activeScenes(game)}）。続行します。`
        + `\n  ${describe(err)}`);
      console.error(err);
    }
  };
  guarded.add(wrapped);
  raf.callback = wrapped;
}

/**
 * 画面ごとの update を包む。
 *
 * Phaser の1フレームは **画面の update → 描画前の処理 → 描画** の順で走り、
 * **キーとパッドの読み取りは「描画前の処理」でまとめて行われる**
 * （`InputManager.preRender` が `Game.step` の `PRE_RENDER` で呼ばれる）。
 * つまり画面の update で例外が出ると、そこから先へ進めず、
 * 絵が止まるだけでなく **キーもパッドも一切読まれなくなる**。
 * 「一度何かすると以後まったく効かない」という症状はこれで起きる。
 *
 * 輪そのものを包む `guardLoop` だけでは足りない ―― 輪は回り続けても、
 * 毎フレーム同じところで落ちれば入力はやはり読まれないまま。
 * update の中で受け止めて、その先の処理へ進ませる必要がある。
 *
 * Phaser は `scene.update` を `sys.sceneUpdate` に写して持つので、そちらを差し替える。
 * 画面は始まった時点で用意されるものもあるため、毎フレーム未処理のものを拾う
 */
function guardSceneUpdates(game: Phaser.Game): void {
  for (const scene of game.scene.scenes) {
    const sys = scene.sys as unknown as { sceneUpdate?: (t: number, d: number) => void };
    const fn = sys.sceneUpdate;
    if (typeof fn !== 'function' || guarded.has(fn)) continue;
    let failures = 0;
    const wrapped = function (this: Phaser.Scene, time: number, delta: number): void {
      try {
        fn.call(this, time, delta);
      } catch (err) {
        failures++;
        note(`${scene.scene.key} の処理でエラーが出ました（${failures} 回目）。`
          + '操作は生かしたまま続けます。'
          + `\n  ${describe(err)}`);
        console.error(err);
      }
    };
    guarded.add(wrapped);
    sys.sceneUpdate = wrapped;
  }
}

/** 動いている画面の名前。どこで止まったかを知らせるのに使う */
function activeScenes(game: Phaser.Game): string {
  try {
    return game.scene.getScenes(true).map((s) => s.scene.key).join(', ') || '（なし）';
  } catch {
    return '（読めず）';
  }
}

/**
 * 描画の輪が回り続けているかを、輪の外から見張る。
 * 止まっていれば画面に出す ―― 「キーもパッドも効かない」という症状のとき、
 * 絵が止まっているのかどうかで原因が分かれるため
 */
function watchHeartbeat(game: Phaser.Game): void {
  let last = -1;
  let stalled = 0;
  window.setInterval(() => {
    const now = game.loop.frame;
    if (now !== last) { last = now; stalled = 0; return; }
    stalled++;
    if (stalled === 3) {                    // 1.5 秒ぶん進んでいない
      note(`画面の更新が止まっています（${now} コマ目・${activeScenes(game)}）。`
        + '\n  この行が出ているときは、操作ではなく描画そのものが止まっています。');
    }
  }, 500);
}

/** 起動直後に一度だけ呼ぶ */
export function installDiagnostics(game: Phaser.Game): void {
  window.addEventListener('error', (e) => {
    note(`エラー: ${e.message}\n  ${e.filename}:${e.lineno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    note(`処理されなかったエラー: ${describe(e.reason)}`);
  });

  // 包みは毎フレーム掛け直す。Phaser 側で入れ替わることがあるうえ、
  // 画面は始まった時点で用意されるものもあるため（下の各関数は掛け済みなら何もしない）
  game.events.on('prestep', () => {
    guardLoop(game);
    guardSceneUpdates(game);
  });

  game.events.once('ready', () => {
    watchHeartbeat(game);
    // フィルム効果は WebGL でしか出せない。Canvas に落ちていると
    // 「Safari では出るのに Chrome では出ない」といった食い違いになる
    const webgl = game.config.renderType === Phaser.WEBGL;
    if (!webgl) {
      note('この環境では WebGL が使えないため、古いフィルム風の効果は出ません。'
        + '\n  Chrome なら 設定 → システム →「ハードウェア アクセラレーションが使用可能な場合は使用する」を入にしてください。');
    }
  });
}

/** Tab の計器表示に出す一行 */
export function rendererLine(game: Phaser.Game): string {
  const webgl = game.config.renderType === Phaser.WEBGL;
  const gl = (game.renderer as { gl?: WebGLRenderingContext }).gl;
  const name = gl ? String(gl.getParameter(gl.RENDERER)).slice(0, 34) : '―';
  return `描画 ${webgl ? 'WebGL' : 'Canvas（フィルム効果なし）'}  ${name}`;
}
