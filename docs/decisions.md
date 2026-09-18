# レビューへの対応と技術選定

2026-09-18、PR #1の5件のレビューを受けて再検討しました。

## Bun

依存管理とスクリプト実行をBun 1.4.2へ移行しました。`bun.lock`とCIのバージョン固定で再現性を保ちます。以前のpnpmロック・設定は削除し、開発手順とF5用タスクも統一しました。Bunの依存管理を採用することと、VS Code拡張ホストのランタイムは別です。拡張本体は引き続きVS CodeのNode.js上で動作し、VS CodeホストテストもNode.jsで実行します。

この規模でのpnpmとの厳密な速度比較はしていないため、一律にBunの方が優れているとは主張しません。今回はユーザーの希望、Windows／Linux対応、ロックファイル運用、既存のVite／Vitestとの互換性を確認したうえで採用します。

参照: [Bun install](https://bun.com/docs/pm/cli/install)

## 型チェック

旧TypeScript 5.9から、ネイティブ実装のTypeScript 7.0.2へ更新しました。正式版は`typescript`パッケージから配布され、実行コマンドも`tsc`です。`tsgo`はプレビュー時の名前なので、コマンド名だけを変えても改善にはなりません。Viteによる変換とは別に、`tsc --noEmit`で型を検証します。

参照: [Microsoft: TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## CSSとTailwind

TailwindもViteと組み合わせて採用可能です。ただし現在は2画面・約240行のCSSで、色・フォント・フォーカスはVS Codeのテーマ変数に従っています。現時点では既存のCSSを維持します。Tailwindにしてもテーマ変数への対応は必要で、いまの画面規模ではビルド依存とクラス表記を増やす利点が小さいと判断しました。

Tailwindはランタイムライブラリではなく、使用クラスに対応するCSSを生成する方式です。将来、画面数や共通コンポーネントが増えた際には再検討できます。その際は動的に組み立てるクラス名を静的な対応表へ変更します。

参照: [Tailwind: class detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)

## 日本語

英語のラベル一覧は画面に固定表示する英語ではなく、翻訳キーです。`vscode.l10n.t()`がVS Codeの表示言語に応じて`l10n/bundle.l10n.ja.json`から日本語に変換し、Webviewへ渡します。拡張のコマンド・設定は`package.nls.ja.json`で翻訳しています。

翻訳キーを`src/labels.ts`へ分離し、各Webviewラベルとmanifestの全キーについて日本語訳の存在をテストします。英語の未コミット変更案内も修正しました。Git自身のエラー出力やコミットメッセージは翻訳対象外です。

## アイコン

画像生成で新しいオリジナルアイコンを作成し、拡張一覧とパネルの双方へ設定しました。既存の簡易SVGは削除しました。透明背景のGitグラフと幾何学的な外形で、青・シアン・紫を使っています。

## CodeQLの警告

前回の「CodeQL成功」はワークフローの正常終了を意味していましたが、警告ゼロを確認できていませんでした。画像URL代入に対する2件の警告について、メッセージ内のURLをそのまま`img.src`へ渡す構造を取り除きました。許可したラスター形式・厳密なBase64・サイズ上限を検証し、デコードしたバイトからローカルBlob URLを生成します。CSPも画像を`blob:`に制限し、URLは読み込み後に解放します。
