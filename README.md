# Git Insights

レビューでの技術選定は [設計判断](docs/decisions.md)、操作の契約とTypeScriptの型による見直しは [設計見直し](docs/interface-first-design.md) に記録しています。

VS Codeでリポジトリ全体のコミットグラフ、ローカル／リモートブランチ、追跡先との差分、ブランチ比較を確認する拡張です。ファイル／行履歴、CodeLens、対話的Rebaseの計画編集も利用できます。日本語／英語対応。独自コードはMITライセンス、アイコンの帰属は [Third-party notices](THIRD-PARTY-NOTICES.md) を参照してください。

## インストール

VS Code 1.96以降とGitが必要です。VS Codeの拡張機能画面の「…」→「VSIXからのインストール」で `git-insights-0.2.1.vsix` を選んでください。

WSLでは対象フォルダーを「WSLで再度開く」で開き、拡張をWSL側にインストールしてください。Gitコマンドはワークスペース側で実行します。信頼されていないワークスペースでは無効です。

## 履歴とCodeLens

まず **Git Insights: リポジトリグラフを開く** を実行するか、アクティビティバーのGit Insightsからリポジトリを選択してください。ファイルを開いていなくても全ブランチを確認できます。

左のブランチを選択して絞り込み、コミットを選んで変更ファイルを確認できます。ローカルブランチの上／下矢印は追跡先に対するahead／behindです。リモート一覧はローカルの記録なので **Fetch** で更新してください。**比較** では2つのブランチやタグを選び、先端同士または共通祖先からの変更を比較できます。上部のブランチ名からローカルブランチを切り替えられます。

GitLens全体を段階的に再現する第1段階です。[対応表と今後の段階](docs/gitlens-parity.md) に実装済み・未実装を記載しています。検索は読み込み済みのコミットが対象、履歴は追加読み込みで最大5,000件です。

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

追跡済みファイルでカーソルを置くと、その行末にBlame（著者・日付・コミット概要）を表示します。コード行または注釈にマウスを重ねると、著者・メールアドレス・日時・コミットメッセージ全文・SHAを確認できます。未保存／保存済みの変更行は「未コミットの変更」と表示し、変更のない行は元のコミットを表示します。未追跡ファイルやコミットのないリポジトリでは表示しません。

`gitInsights.blame.enabled`（初期値 `true`）で注釈と詳細ホバーを切り替えられます。VS Code標準の行末Blameと重なる場合は、標準側の `git.blame.editorDecoration.enabled` を無効にしてください。

| 設定                           | 初期値  | 内容                 |
| ------------------------------ | ------- | -------------------- |
| `gitInsights.codeLens.enabled` | `true`  | 最終変更者の表示     |
| `gitInsights.gravatar.enabled` | `false` | Gravatarの取得       |
| `gitInsights.history.limit`    | `100`   | 履歴上限（10〜1000） |

テレメトリ、AI、分析SDKはありません。Gravatarを有効にした場合のみ、正規化したメールアドレスのSHA-256ハッシュをGravatarへ送信します。ハッシュも個人を識別し得る情報です。画像はセッション内メモリに最大200件キャッシュし、無効化時に破棄します。リモートで開く操作は、ユーザー操作時のみ外部ブラウザーを開きます。Fetchとブランチ切り替えは明示的な画面操作時のみ実行します。pushや履歴の自動書き換えは実行しません。

他の拡張のコード・CSS・アイコンを流用せず、VS Code APIとGit CLIで実装しています。

## 開発

Node.js 24とBun 1.4.2を推奨します。

```sh
bun install --frozen-lockfile
bun run check
bun run test:host
bun run package
```

`bun run test:host` は独立した一時リポジトリとプロファイルでVS Codeを起動します。初回はVS Codeをダウンロードします。既存の実行ファイルを使う場合は `VSCODE_EXECUTABLE_PATH` を指定してください。LinuxのGUIなし環境では `xvfb-run -a bun run test:host` を使います。F5でも拡張開発ホストを起動できます。

構成: TypeScript、Vite 8、Vanilla TS Webview、oxlint／oxfmt、Vitest。Git CLIはシェルを介さず実行し、タイムアウトと出力量の制限があります。WebviewはCSP・ローカルスクリプト・`textContent`を使用し、コミットメッセージをHTMLとして解釈しません。

CIはWindows／Linuxで型・lint・format・Git実データテスト・ビルド・VSIX作成を実行し、CodeQLを別ワークフローで実行します。Marketplaceへの自動公開はありません。

## GitHub Releasesへの公開

このワークフローをmainへマージした後、Actionsの **Release → Run workflow** で試運転できます。`publish` をOFFにすると検査・VSIX作成のみを実行します。

正式公開は `package.json` のバージョンと一致するタグをpushします。初回は現在の `0.2.1` を使用できます。

```sh
git switch main
git pull --ff-only
git tag v0.2.1
git push origin v0.2.1
```

タグのコミットに対しWindows／Linuxの型検査・テスト・VS Code起動テスト・VSIX作成がすべて通ると、GitHub Releaseを公開します。Linux側で作成した共通VSIXと `SHA256SUMS.txt` を添付し、リリースノートを自動生成します。追加のシークレットは不要です。GitHub標準の `GITHUB_TOKEN` を使用し、公開ジョブだけに書き込み権限を与えています。

手動公開は **Run workflow** の対象に既存の `v0.2.1` タグを選び、`publish` をONにしてください。ブランチからの公開やバージョン不一致は拒否します。現在は `v数字.数字.数字` の正式版のみ対応しています。

既存リリースは上書きしません。公開前に失敗した場合は原因を直して再実行できます。ドラフトが残った場合は添付ファイルを確認してGitHub上で公開するか、ドラフトのみ削除して再実行してください。公開済みの版に変更を加える場合は新しいバージョンとタグを使用します。Marketplaceへの公開は行いません。

## English quick start

Install the VSIX, open a tracked file, then run **Git Insights: Show File History**. Switch to **Line** for the selected committed lines. Expand a commit and select a changed file to open its diff. Pin fixes the current file and range. CodeLens requires document symbols from a language extension and a clean file.

Run `git -c sequence.editor="code --wait" rebase -i HEAD~3` to edit a rebase plan. Change actions/order, click **Save**, then close the tab. Closing without saving continues with the original plan; it does not abort rebase. Advanced todo commands fall back to the text editor. Gravatar is opt-in; no telemetry is collected.
