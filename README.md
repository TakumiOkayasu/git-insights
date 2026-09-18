# Git Insights

VS Codeでファイル・選択行の変更履歴と最終変更者を確認し、対話的Rebaseの計画を編集する拡張です。日本語／英語に対応します。MITライセンス。Marketplaceへの公開は行わず、VSIXでインストールします。

## インストール

VS Code 1.96以降とGitが必要です。VS Codeの拡張機能画面の「…」→「VSIXからのインストール」で `git-insights-0.1.0.vsix` を選んでください。

WSLでは対象フォルダーを「WSLで再度開く」で開き、拡張をWSL側にインストールしてください。Gitコマンドはワークスペース側で実行します。信頼されていないワークスペースでは無効です。

## 履歴とCodeLens

- Git管理下のファイルを開き、コマンドパレットから **Git Insights: ファイル履歴を表示** を実行します。
- 下部の **Git Insights** パネルで「ファイル／行」を切り替えます。行モードは選択範囲に追従します。
- コミットの件名をクリックすると著者・メール・完全SHA・日時・変更ファイルが展開されます。変更ファイルをクリックすると親コミットとの差分を開きます。最初のコミットは空の内容と比較し、マージは第1親と比較します。
- SHAはクリックでコピー、↗はGitHub／GitLab.com／Bitbucket.orgの `origin` をブラウザーで開きます。
- ◇でファイルと選択範囲をピン留めできます。ビュー見出しのメニューからサイドバーへ移動できます。
- 言語拡張が関数・クラスのシンボルを提供する場合、その上に最終変更者を表示します。クリックするとファイル履歴へ移動します。

行番号の誤対応を防ぐため、行履歴とCodeLensは対象ファイルに未コミットの変更がある場合に制限します。CodeLensは非表示、行履歴には案内を表示します。ファイル履歴は利用できます。履歴の上限は初期値100件で、設定から最大1000件まで変更できます。

## 対話的Rebase

既存の `git-rebase-todo` を開くと専用エディタになります。コマンド **Git Insights: Rebaseエディタを開く** でもファイルを指定できます。

新しく対話的Rebaseを開始する例（対象リポジトリのターミナルで実行）:

```sh
git -c sequence.editor="code --wait" rebase -i HEAD~3
```

この指定はその1回だけ適用され、Gitのグローバル設定は変更しません。WSLではWSLのターミナルから実行してください。`code` がPATHに必要です。

1. `pick / reword / edit / squash / fixup / drop` を選択します。
2. ドラッグ、または上下ボタンで順序を変えます。
3. 画面内の「保存」を押し、タブを閉じます。`code --wait` の終了後にGitが続行します。

画面内での変更は「保存」を押すまでファイルへ反映しません。保存せずに閉じた場合は元の計画でGitが続行します。**閉じる操作はRebaseの中止ではありません。** 停止中のRebaseを中止する場合はターミナルで `git rebase --abort` を使用してください。競合の解決や `reword` のメッセージ編集はGit／VS Codeの通常の手順で行います。

`exec`、`label`、`reset`、`merge`、`fixup -C/-c` などの高度な命令を含む計画はGUIから保存せず、「テキストで開く」を案内します。コメントと改行コードを保持し、統合先のないsquash/fixupや外部編集との競合を検出します。

## 設定とプライバシー

| 設定                           | 初期値  | 内容                 |
| ------------------------------ | ------- | -------------------- |
| `gitInsights.codeLens.enabled` | `true`  | 最終変更者の表示     |
| `gitInsights.gravatar.enabled` | `false` | Gravatarの取得       |
| `gitInsights.history.limit`    | `100`   | 履歴上限（10〜1000） |

テレメトリ、AI、分析SDKはありません。Gravatarを有効にした場合のみ、正規化したメールアドレスのSHA-256ハッシュをGravatarへ送信します。ハッシュも個人を識別し得る情報です。画像はセッション内メモリに最大200件キャッシュし、無効化時に破棄します。リモートで開く操作は、ユーザー操作時のみ外部ブラウザーを開きます。Gitのfetch/pushや履歴の自動書き換えは実行しません。

他の拡張のコード・CSS・アイコンを流用せず、VS Code APIとGit CLIで実装しています。

## 開発

Node.js 24とpnpm 11.19.0を推奨します。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:host
pnpm package
```

`pnpm test:host` は独立した一時リポジトリとプロファイルでVS Codeを起動します。初回はVS Codeをダウンロードします。既存の実行ファイルを使う場合は `VSCODE_EXECUTABLE_PATH` を指定してください。LinuxのGUIなし環境では `xvfb-run -a pnpm test:host` を使います。F5でも拡張開発ホストを起動できます。

構成: TypeScript、Vite 8、Vanilla TS Webview、oxlint／oxfmt、Vitest。Git CLIはシェルを介さず実行し、タイムアウトと出力量の制限があります。WebviewはCSP・ローカルスクリプト・`textContent`を使用し、コミットメッセージをHTMLとして解釈しません。

CIはWindows／Linuxで型・lint・format・Git実データテスト・ビルド・VSIX作成を実行し、CodeQLを別ワークフローで実行します。Marketplaceへの自動公開はありません。

## English quick start

Install the VSIX, open a tracked file, then run **Git Insights: Show File History**. Switch to **Line** for the selected committed lines. Expand a commit and select a changed file to open its diff. Pin fixes the current file and range. CodeLens requires document symbols from a language extension and a clean file.

Run `git -c sequence.editor="code --wait" rebase -i HEAD~3` to edit a rebase plan. Change actions/order, click **Save**, then close the tab. Closing without saving continues with the original plan; it does not abort rebase. Advanced todo commands fall back to the text editor. Gravatar is opt-in; no telemetry is collected.
