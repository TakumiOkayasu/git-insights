import * as vscode from "vscode";
import { type Git, type Blame, type Commit, type Change, remoteCommitUrl } from "./git";
import { blameHover, blameCommands, type BlameDetails } from "./blame-hover";

type Attribution = { kind: "committed"; root: string; commit: Commit } | { kind: "uncommitted" };
type Snapshot = { root: string; chunks: Blame[] };

/** Owns document-version caches; repository changes explicitly invalidate them. */
export class LineBlame implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 3em", color: new vscode.ThemeColor("editorCodeLens.foreground") },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly snapshots = new Map<string, Promise<Snapshot>>();
  private readonly commits = new Map<string, Promise<Commit>>();
  private readonly changes = new Map<string, Promise<Change[]>>();
  private readonly remotes = new Map<string, Promise<string>>();
  private current?: { commit: Commit; remoteUrl?: string };
  private readonly listeners: vscode.Disposable[];
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly git: Git,
    private readonly avatar: (email: string) => Promise<string | undefined>,
  ) {
    this.listeners = [
      vscode.commands.registerCommand(blameCommands.copy, (generation: unknown) => {
        if (generation === this.generation && this.current)
          return vscode.env.clipboard.writeText(this.current.commit.sha);
      }),
      vscode.commands.registerCommand(blameCommands.remote, (generation: unknown) => {
        if (generation === this.generation && this.current?.remoteUrl)
          return vscode.env.openExternal(vscode.Uri.parse(this.current.remoteUrl));
      }),
      vscode.commands.registerCommand(blameCommands.settings, () =>
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:TakumiOkayasu.git-insights",
        ),
      ),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument(() => this.refresh()),
      vscode.workspace.onDidCloseTextDocument(() => this.refresh()),
    ];
    this.schedule();
  }
  refresh() {
    this.snapshots.clear();
    this.remotes.clear();
    this.schedule();
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.listeners.forEach((listener) => listener.dispose());
    this.decoration.dispose();
    this.snapshots.clear();
    this.commits.clear();
    this.changes.clear();
    this.remotes.clear();
    this.current = undefined;
  }
  private enabled() {
    return (
      !this.disposed && vscode.workspace.getConfiguration("gitInsights").get("blame.enabled", true)
    );
  }
  private schedule() {
    this.current = undefined;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    for (const editor of vscode.window.visibleTextEditors)
      editor.setDecorations(this.decoration, []);
    if (this.enabled()) this.timer = setTimeout(() => void this.render(generation), 200);
  }
  private async attribution(
    document: vscode.TextDocument,
    line: number,
  ): Promise<Attribution | undefined> {
    if (!this.enabled() || document.uri.scheme !== "file" || document.isClosed) return;
    const key = `${document.uri.toString()}:${document.version}`;
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      if (this.snapshots.size >= 20) this.snapshots.clear();
      snapshot = (async () => {
        const contents = document.getText();
        const root = await this.git.root(document.uri.fsPath);
        return { root, chunks: await this.git.blameContents(root, document.uri.fsPath, contents) };
      })();
      this.snapshots.set(key, snapshot);
      void snapshot.catch(() => {
        if (this.snapshots.get(key) === snapshot) this.snapshots.delete(key);
      });
    }
    const { root, chunks } = await snapshot;
    const chunk = chunks.find(
      (item) => item.start <= line + 1 && line + 1 < item.start + item.count,
    );
    if (!chunk) return;
    if (/^0+$/.test(chunk.sha)) return { kind: "uncommitted" };
    const commitKey = `${root}:${chunk.sha}`;
    let commit = this.commits.get(commitKey);
    if (!commit) {
      if (this.commits.size >= 100) this.commits.clear();
      commit = this.git.commit(root, chunk.sha);
      this.commits.set(commitKey, commit);
      void commit.catch(() => {
        if (this.commits.get(commitKey) === commit) this.commits.delete(commitKey);
      });
    }
    return { kind: "committed", root, commit: await commit };
  }
  private async details(root: string, commit: Commit): Promise<BlameDetails> {
    const key = `${root}:${commit.sha}`;
    let changes = this.changes.get(key);
    if (!changes) {
      if (this.changes.size >= 100) this.changes.clear();
      changes = this.git.details(root, commit);
      this.changes.set(key, changes);
      void changes.catch(() => {
        if (this.changes.get(key) === changes) this.changes.delete(key);
      });
    }
    let remote = this.remotes.get(root);
    if (!remote) {
      remote = this.git.run(root, ["config", "--get", "remote.origin.url"]);
      if (this.remotes.size >= 20) this.remotes.clear();
      this.remotes.set(root, remote);
    }
    const [stats, origin, avatar] = await Promise.allSettled([
      changes,
      remote,
      this.avatar(commit.email),
    ]);
    return {
      changes: stats.status === "fulfilled" ? stats.value : undefined,
      statisticsFailed: stats.status === "rejected",
      remoteUrl:
        origin.status === "fulfilled"
          ? remoteCommitUrl(origin.value.trim(), commit.sha)
          : undefined,
      avatar: avatar.status === "fulfilled" ? avatar.value : undefined,
    };
  }
  private async render(generation: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.selection.isEmpty) return;
    const line = editor.selection.active.line;
    const version = editor.document.version;
    try {
      const attribution = await this.attribution(editor.document, line);
      const current = () =>
        generation === this.generation && editor.document.version === version && this.enabled();
      if (!attribution || !current()) return;
      const text =
        attribution.kind === "uncommitted"
          ? vscode.l10n.t("Uncommitted changes")
          : `${attribution.commit.author}, ${new Date(attribution.commit.date).toLocaleDateString(vscode.env.language)} • ${attribution.commit.subject}`;
      const show = (details: BlameDetails = {}) => {
        this.current =
          attribution.kind === "committed"
            ? { commit: attribution.commit, remoteUrl: details.remoteUrl }
            : undefined;
        editor.setDecorations(this.decoration, [
          {
            range: new vscode.Range(
              editor.document.lineAt(line).range.end,
              editor.document.lineAt(line).range.end,
            ),
            hoverMessage: blameHover(
              attribution.kind === "committed" ? attribution.commit : undefined,
              details,
              generation,
            ),
            renderOptions: { after: { contentText: text.replace(/[\r\n\t]/g, " ").slice(0, 180) } },
          },
        ]);
      };
      show();
      if (attribution.kind === "committed") {
        const details = await this.details(attribution.root, attribution.commit);
        if (current()) show(details);
      }
    } catch {
      /* No annotations for files Git cannot blame. */
    }
  }
}
