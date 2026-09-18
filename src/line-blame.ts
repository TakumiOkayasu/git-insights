import * as vscode from "vscode";
import type { Git, Blame, Commit } from "./git";

type Attribution = { kind: "committed"; commit: Commit } | { kind: "uncommitted" };
type Snapshot = { root: string; chunks: Blame[] };

/** Owns document-version caches; repository changes explicitly invalidate them. */
export class LineBlame implements vscode.HoverProvider, vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 3em", color: new vscode.ThemeColor("editorCodeLens.foreground") },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private readonly snapshots = new Map<string, Promise<Snapshot>>();
  private readonly commits = new Map<string, Promise<Commit>>();
  private readonly listeners: vscode.Disposable[];
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private disposed = false;

  constructor(private readonly git: Git) {
    this.listeners = [
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument(() => this.refresh()),
      vscode.workspace.onDidCloseTextDocument(() => this.refresh()),
    ];
    this.schedule();
  }
  refresh() {
    this.snapshots.clear();
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
  }
  private enabled() {
    return (
      !this.disposed && vscode.workspace.getConfiguration("gitInsights").get("blame.enabled", true)
    );
  }
  private schedule() {
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
    return { kind: "committed", commit: await commit };
  }
  private markdown(attribution: Attribution) {
    const markdown = new vscode.MarkdownString();
    // Repository-controlled text is never interpreted as Markdown or commands.
    markdown.appendMarkdown("**Git Insights · Blame**\n\n");
    if (attribution.kind === "uncommitted")
      return markdown.appendText(vscode.l10n.t("Uncommitted changes"));
    const { commit } = attribution;
    markdown.appendText(
      `${commit.author} <${commit.email}>\n${new Date(commit.date).toLocaleString(vscode.env.language)}\n\n${commit.subject}`,
    );
    if (commit.body.trim()) markdown.appendText(`\n\n${commit.body.trim()}`);
    markdown.appendText(`\n\n${commit.sha}`);
    return markdown;
  }
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ) {
    const version = document.version;
    const generation = this.generation;
    try {
      const attribution = await this.attribution(document, position.line);
      if (
        !attribution ||
        token.isCancellationRequested ||
        document.version !== version ||
        generation !== this.generation ||
        !this.enabled()
      )
        return;
      return new vscode.Hover(this.markdown(attribution), document.lineAt(position.line).range);
    } catch {
      return; /* Untracked files and repositories without commits have no blame. */
    }
  }
  private async render(generation: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.selection.isEmpty) return;
    const line = editor.selection.active.line;
    const version = editor.document.version;
    try {
      const attribution = await this.attribution(editor.document, line);
      if (
        !attribution ||
        generation !== this.generation ||
        editor.document.version !== version ||
        !this.enabled()
      )
        return;
      const text =
        attribution.kind === "uncommitted"
          ? vscode.l10n.t("Uncommitted changes")
          : `${attribution.commit.author}, ${new Date(attribution.commit.date).toLocaleDateString(vscode.env.language)} • ${attribution.commit.subject}`;
      editor.setDecorations(this.decoration, [
        {
          range: new vscode.Range(
            editor.document.lineAt(line).range.end,
            editor.document.lineAt(line).range.end,
          ),
          hoverMessage: this.markdown(attribution),
          renderOptions: { after: { contentText: text.replace(/[\r\n\t]/g, " ").slice(0, 180) } },
        },
      ]);
    } catch {
      /* No annotations for files Git cannot blame. */
    }
  }
}
