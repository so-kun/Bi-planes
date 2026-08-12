# Bi-Planes プロジェクト

レトロゲーム Bi-Planes のブラウザ版リメイク。2人対戦2D空戦ゲーム。

## セッション開始時に必ず読むこと

1. `docs/decisions.md` — 確定した決定事項（これに反する提案・実装をしない）
2. `docs/progress.md` — 現在のフェーズと直近の経過
3. `.claude/rules/workflow.md` — 進め方のルール

## 技術スタック（確定）

Phaser 3 + TypeScript + Vite + 自作フライトモデル。詳細は `docs/decisions.md`。

## 動かす

`npm run dev` で開発サーバ。`npm run build` で型チェックとビルド。
飛行の数値は `src/config.ts` に集約。`node tools/flight-probe.mjs` で
ブラウザなしに速度・失速・宙返りの大きさを確認できる。

## 絶対ルール

- 未確定の項目（decisions.md で「検討中」のもの）は実装せず、提案とサンプルで合意を取る
- 作業は main からブランチを切り、PR で進める。main へ直接 push しない
- 区切りがついたら PR を main にマージする。長く開いたままにしない
- 決定・経過は必ず docs/ に記録してからセッションを終える
