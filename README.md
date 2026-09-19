# Git Insights

VS Code用のGit履歴・グラフ表示拡張です。日本語と英語に対応しています。

## 利用

VS Code 1.96以降とGitが必要です。VSIXからインストールしてください。WSLでは拡張をWSL側にインストールします。

- **Git Insights: リポジトリグラフを開く**: ターミナルと同じパネル領域でグラフを表示します。ブランチ比較、Fetch、ローカルブランチ切り替えができます。
- **ファイル履歴を表示 / 行履歴を表示**: 履歴を表示し、変更ファイルの差分をエディタで開きます。
- **Rebaseエディタを開く**: 既存の `git-rebase-todo` をエディタ領域で編集します。保存して閉じるとGitが続行します。閉じるだけでは中止できません。中止は `git rebase --abort` を使用してください。
- グラフのコミット詳細から **Cherry-pickを確認 / メッセージ変更を確認** を選ぶと、エディタで対象と適用先を確認して実行できます。作業ツリーがクリーンなローカルブランチで、単一の非マージコミットを扱います。過去コミットのメッセージ変更は現在のブランチ上で後続にマージがない場合に対応します。
- 実行前にエディタを閉じると変更はありません。実行後に閉じてもGit処理は中止されません。競合時は対象リポジトリで `git status` を確認し、Git標準の継続・中止操作を使用してください。

グラフ・履歴・FetchはローカルのGit設定を使用します。コミットのブラウザー表示はGitHub.com、GitLab.com (サブグループを含む)、Bitbucket.orgに対応しています。Self-ManagedのブラウザーリンクやPR/MRのAPI連携は未対応です。

## 設定

| 設定                           | 初期値  | 内容                              |
| ------------------------------ | ------- | --------------------------------- |
| `gitInsights.blame.enabled`    | `true`  | 行末の変更者と詳細ホバー          |
| `gitInsights.codeLens.enabled` | `true`  | 関数・クラスの最終変更者          |
| `gitInsights.history.limit`    | `100`   | ファイル・行履歴の上限 (10〜1000) |
| `gitInsights.gravatar.enabled` | `false` | 著者アバターの取得                |

AI機能とテレメトリはありません。Gravatar有効時のみメールアドレスのSHA-256ハッシュを送信します。信頼されていないワークスペースでは動作しません。

## 開発

Node.js 24、Bun 1.4.2を使用します。

```sh
bun install --frozen-lockfile
bun run check
bun run test:host
bun run package
```

LinuxのGUIなし環境では `xvfb-run -a bun run test:host` を使用します。

公開ドキュメントは利用・開発に必要な情報に限定し、詳細な比較資料・設計検討・ロードマップは掲載しません。

[MIT License](LICENSE) / [Third-party notices](THIRD-PARTY-NOTICES.md)
