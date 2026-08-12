# Bi-Planes

レトロゲーム Bi-Planes をブラウザゲームとして再構築するプロジェクト。

- 2人対戦（1台のキーボード）の2D空戦ゲーム
- 自作フライトモデルによるリアルな操作感（失速・エネルギー管理）
- ヴィンテージのペン画＋水彩のアート（提供イラストをそのまま使用）
- Web Audio による自己完結のサウンド
- 古いフィルム風のポストエフェクト

## 動かす

```
npm install
npm run dev      # 開発サーバ。表示された URL をブラウザで開く
npm run build    # 型チェック + 本番ビルド（dist/ に出力）
npm run preview  # ビルド結果を確認
```

## 現在の状態: M1（1P プレイテスト版）

操作感と効果音を確かめるための版。対戦相手はまだ出さず、気球と空だけ。

| 操作 | キー |
|---|---|
| 機首上げ / 下げ | W / S（↑ / ↓ も可） |
| **全開**（押している間だけ。離すと巡航） | E |
| ロール（正立 ⇄ 背面） | A / D（← / → も可。左右で回る向きが変わる） |
| 7.7mm 機銃 | F（押しっぱなしで連射） |
| 20mm 機関砲 | G |
| フィルム強度（切／弱／既定／標準／強） | 1〜5 |
| BGM の入切 | B |
| 消音 | M |
| 計器表示の入切 | Tab |

**背面飛行では上下の操作が入れ替わります**（機体基準）。宙返りで左向きになると背面に
なるので、正立に戻すにはロールが要ります。実機と同じ挙動です。

## 調整

飛行の数値は `src/config.ts` に集約してあります。ブラウザを立ち上げずに確かめるには:

```
node tools/flight-probe.mjs
```

水平飛行の速度、失速する速度、宙返りの大きさ、急上昇からの立て直しを一度に出します。

## 公開する（Vercel）

静的サイトとしてビルドされるので、そのまま Vercel に載せられます。`vercel.json` は用意済みです。

**ダッシュボードから:**
1. https://vercel.com/new でこのリポジトリを Import
2. Framework は Vite が自動で選ばれる。Build Command / Output Directory も `vercel.json` の
   指定（`npm run build` / `dist`）が使われるので、そのまま Deploy
3. ブランチを指定する場合は Settings → Git → Production Branch で切り替える

**CLI から:**
```
npx vercel          # プレビュー環境へ
npx vercel --prod   # 本番へ
```

ビルド結果は約 5.8MB です。原本イラスト（`assets/art/original/`、34MB）は実行時に使わないので、
`vite.config.ts` のプラグインでビルド後に取り除いています。

## 素材

原本は `assets/art/original/` に無加工で置き、加工物は次で再生成できます:

```
python3 tools/cutout.py          # 紙地を抜いて透過 PNG に
python3 tools/extract_smoke.py   # 煙のひと粒を切り出す
```

ゲームで使うスプライトは長辺 640px（気球は 512px）に縮めて書き出しています。表示幅が 102px
なので原寸の 1536px は過剰なためです。画質を上げたくなったら `tools/cutout.py` の
`RUNTIME_MAX_WIDTH` を変えて作り直してください。原本は無加工のまま残してあります。

## 進め方

決定事項は `docs/decisions.md`、経過は `docs/progress.md`、
ゲーム仕様は `docs/game-design.md` に記録しています。詳細は `CLAUDE.md` を参照。
