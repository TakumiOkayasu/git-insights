import * as vscode from "vscode";
import path from "node:path";
import { Git } from "./git";
import { createRepository, type RepositorySnapshot, type RevisionSelection } from "./repository";
import { parseGraphRequest, type GraphMessage } from "./graph-protocol";
import type { BuiltinGitApi } from "./vscode-git";
import type { ComparisonFactory } from "./git-comparison";

export class GraphWorkbench
  implements vscode.Disposable, vscode.TreeDataProvider<vscode.TreeItem>, vscode.WebviewViewProvider
{
  private view?: vscode.WebviewView;
  private root = "";
  private focus = "";
  private limit = 300;
  private generation = 0;
  private selectionId = 0;
  private snapshot?: RepositorySnapshot;
  private selection?: RevisionSelection;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    private readonly git: Git,
    private readonly api: BuiltinGitApi | undefined,
    private readonly comparisons: ComparisonFactory,
    private readonly html: (view: vscode.Webview) => string,
  ) {}
  private repositories() {
    return (this.api?.repositories ?? []).map((repo) => ({
      id: repo.rootUri.fsPath,
      name: path.basename(repo.rootUri.fsPath),
    }));
  }
  getTreeItem(item: vscode.TreeItem) {
    return item;
  }
  getChildren() {
    return this.repositories().map((repo) => {
      const item = new vscode.TreeItem(repo.name);
      item.tooltip = repo.id;
      item.iconPath = new vscode.ThemeIcon("repo");
      item.command = {
        command: "gitInsights.openGraph",
        title: "Open repository graph",
        arguments: [repo.id],
      };
      return item;
    });
  }
  async show(id?: string) {
    if (id && this.repositories().some((r) => r.id === id)) {
      this.root = id;
      this.focus = "";
    }
    await vscode.commands.executeCommand("gitInsights.graph.focus");
    this.view?.show();
    await this.refresh();
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const listener = view.webview.onDidReceiveMessage((value: unknown) => {
      void this.message(value).catch((e) =>
        this.post({ type: "graphError", message: e instanceof Error ? e.message : String(e) }),
      );
    });
    const visibility = view.onDidChangeVisibility(() => {
      if (view.visible) void this.refresh();
    });
    view.onDidDispose(() => {
      listener.dispose();
      visibility.dispose();
      if (this.view === view) this.view = undefined;
      this.generation++;
      this.selectionId++;
      this.snapshot = undefined;
      this.selection = undefined;
    });
    view.webview.html = this.html(view.webview);
  }

  schedule() {
    this.changed.fire();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.busy) void this.refresh();
    }, 400);
  }
  private post(message: GraphMessage) {
    return this.view?.webview.postMessage(message);
  }
  async refresh() {
    if (!this.view?.visible) return;
    const repositories = this.repositories();
    if (!repositories.some((r) => r.id === this.root)) {
      this.root = repositories[0]?.id ?? "";
      this.focus = "";
    }
    const generation = ++this.generation;
    this.selectionId++;
    this.snapshot = undefined;
    this.selection = undefined;
    const context = {
      repositories,
      repository: this.root,
      generation,
      locale: vscode.env.language,
      focus: this.focus,
    };
    const show = (state: Extract<GraphMessage, { type: "graph" }>["state"]) => {
      if (generation === this.generation) void this.post({ type: "graph", ...context, state });
    };
    if (!this.root) {
      show({ status: "empty" });
      return;
    }
    show({ status: "loading" });
    try {
      const snapshot = await createRepository(this.git, this.root).snapshot(
        this.limit,
        this.focus || undefined,
      );
      if (generation !== this.generation) return;
      this.snapshot = snapshot;
      show({ status: "ready", snapshot });
    } catch (error) {
      show({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  private async message(value: unknown) {
    const m = parseGraphRequest(value);
    if (!m || this.busy) return;
    if (m.type === "ready" || m.type === "refresh") return this.refresh();
    if (m.type === "history") return vscode.commands.executeCommand("gitInsights.fileHistory");
    if (m.type === "repository") {
      if (!this.repositories().some((r) => r.id === m.id)) return;
      this.root = m.id;
      this.focus = "";
      this.limit = 300;
      return this.refresh();
    }
    if (m.type === "focus" && !m.ref) {
      this.focus = "";
      this.limit = 300;
      return this.refresh();
    }
    if (!this.root || !this.snapshot) return;
    const root = this.root;
    const snapshot = this.snapshot;
    if (m.type === "focus") {
      if (m.ref && !snapshot.refs.some((r) => r.id === m.ref)) return;
      this.focus = m.ref;
      this.limit = 300;
      return this.refresh();
    }
    if (m.type === "more") {
      this.limit = Math.min(5000, this.limit + 300);
      return this.refresh();
    }
    if (m.type === "fetch" || m.type === "checkout") {
      this.busy = true;
      try {
        if (m.type === "fetch")
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: vscode.l10n.t("Fetching remotes…"),
            },
            () => createRepository(this.git, root).fetch(),
          );
        else {
          const branch = await vscode.window.showQuickPick(
            snapshot.refs.filter((r) => r.kind === "local" && !r.current).map((r) => r.name),
            { placeHolder: vscode.l10n.t("Switch local branch") },
          );
          if (branch) {
            await this.git.run(root, ["switch", "--", branch]);
            this.focus = "";
          }
        }
      } finally {
        this.busy = false;
        await this.refresh();
      }
      return;
    }
    if (!("generation" in m) || m.generation !== this.generation) return;
    const generation = this.generation;
    const known = (sha: string) =>
      snapshot.commits.some((c) => c.sha === sha) || snapshot.refs.some((r) => r.sha === sha);
    if (m.type === "copy") {
      if (known(m.sha)) await vscode.env.clipboard.writeText(m.sha);
      return;
    }
    if (m.type === "inspect" || m.type === "compare") {
      if (m.type === "inspect" ? !known(m.sha) : !known(m.base) || !known(m.target)) return;
      const selectionId = ++this.selectionId;
      this.selection = undefined;
      const repository = createRepository(this.git, root);
      const selection =
        m.type === "inspect"
          ? await repository.inspect(m.sha)
          : await repository.compare(m.base, m.target, m.commonBase);
      if (generation !== this.generation || selectionId !== this.selectionId) return;
      this.selection = selection;
      await this.post({ type: "selection", generation, selection: selectionId, value: selection });
      return;
    }
    if (m.type === "diff" && m.selection === this.selectionId && this.selection) {
      const selection = this.selection;
      const change = selection.changes.find((c) => c.path === m.path);
      if (!change) return;
      await this.comparisons
        .create(
          root,
          { sha: selection.after, parents: selection.before ? [selection.before] : [] },
          change,
          () => generation === this.generation && m.selection === this.selectionId,
        )
        .open();
    }
  }
  dispose() {
    clearTimeout(this.timer);
    this.view = undefined;
    this.generation++;
    this.selectionId++;
    this.changed.dispose();
  }
}
