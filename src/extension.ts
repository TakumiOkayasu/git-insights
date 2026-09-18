import * as vscode from "vscode";
import { createHash, randomBytes } from "node:crypto";
import { Git, type Commit, type Change, type Blame, remoteCommitUrl } from "./git";
import { parseTodo, serializeTodo } from "./rebase";

import { translateLabels } from "./labels";
import {
  parseHistoryRequest,
  parseRebaseRequest,
  type HostMessage,
  type HistoryResult,
  type HistoryMessage,
  type Scope,
} from "./protocol";
import { createComparisonFactory, type ComparisonFactory } from "./git-comparison";
import { createComparisonPresenter } from "./vscode-comparison";
import type { BuiltinGitExtension, GitRepository } from "./vscode-git";
// English strings are translation keys, resolved by VS Code from l10n/bundle.l10n.ja.json.
const labels = () => translateLabels((key) => vscode.l10n.t(key));
const postMessage = (view: vscode.Webview, message: HostMessage) => view.postMessage(message);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const config = () => vscode.workspace.getConfiguration("gitInsights");
function html(webview: vscode.Webview, extension: vscode.Uri, mode: string): string {
  const nonce = randomBytes(18).toString("base64");
  const resource = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extension, "dist", "webview", name));
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extension, "dist", "webview")],
  };
  return `<!doctype html><html lang="${vscode.env.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource("main.css")}"></head><body data-mode="${mode}"><main id="app"></main><script nonce="${nonce}" src="${resource("main.js")}"></script></body></html>`;
}

class Avatars {
  private cache = new Map<string, Promise<string | undefined>>();
  clear() {
    this.cache.clear();
  }
  get(email: string): Promise<string | undefined> {
    if (!config().get("gravatar.enabled", false)) return Promise.resolve(undefined);
    const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    let entry = this.cache.get(hash);
    if (!entry) {
      entry = this.fetch(hash);
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(hash, entry);
    }
    return entry;
  }
  private async fetch(hash: string): Promise<string | undefined> {
    try {
      const response = await fetch(`https://www.gravatar.com/avatar/${hash}?s=48&d=404`, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (
        !response.ok ||
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime ?? "") ||
        !response.body
      )
        return;
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 128 * 1024) return;
        parts.push(chunk);
      }
      return `data:${mime};base64,${Buffer.concat(parts).toString("base64")}`;
    } catch {
      return undefined;
    }
  }
}

class History implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private editor?: vscode.TextEditor;
  private pinned?: { file: string; range: [number, number] };
  private mode: Scope = "file";
  private generation = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private commits = new Map<string, Commit>();
  private changes = new Map<string, Change[]>();
  private root = "";
  private listeners: vscode.Disposable[] = [];
  constructor(
    private context: vscode.ExtensionContext,
    private git: Git,
    private avatars: Avatars,
    private comparisons: ComparisonFactory,
  ) {
    this.editor = vscode.window.activeTextEditor;
    this.listeners.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e?.document.uri.scheme === "file") {
          this.editor = e;
          this.schedule();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === this.editor && this.mode === "line") this.schedule();
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule()),
    );
  }
  dispose() {
    this.controller?.abort();
    clearTimeout(this.timer);
    this.listeners.forEach((d) => d.dispose());
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 300);
  }
  async show(mode: Scope) {
    this.mode = mode;
    this.pinned = undefined;
    const e = vscode.window.activeTextEditor;
    if (e?.document.uri.scheme === "file") this.editor = e;
    await vscode.commands.executeCommand("gitInsights.history.focus");
    await this.refresh();
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.html = html(view.webview, this.context.extensionUri, "history");
    const sub = view.webview.onDidReceiveMessage((m: unknown) => {
      void this.message(m).catch((e) => {
        void vscode.window.showErrorMessage(errorMessage(e));
      });
    });
    view.onDidDispose(() => {
      sub.dispose();
      if (this.view === view) this.view = undefined;
    });
  }
  private target(): { file: string; range: [number, number] } | undefined {
    if (this.pinned) return this.pinned;
    if (!this.editor || this.editor.document.uri.scheme !== "file" || this.editor.document.isClosed)
      return;
    const s = this.editor.selection;
    return {
      file: this.editor.document.uri.fsPath,
      range: [
        s.start.line + 1,
        Math.max(s.start.line + 1, s.end.line + (s.end.character === 0 && !s.isEmpty ? 0 : 1)),
      ],
    };
  }
  async refresh() {
    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const generation = ++this.generation;
    this.commits.clear();
    this.changes.clear();
    if (!this.view) return;
    const target = this.target();
    const base: Omit<HistoryMessage, "result"> = {
      type: "history",
      generation,
      labels: labels(),
      locale: vscode.env.language,
      pinned: !!this.pinned,
      context: !target
        ? { mode: this.mode, file: null }
        : this.mode === "line"
          ? { mode: "line", file: target.file, range: target.range }
          : { mode: "file", file: target.file },
    };
    const post = (result: HistoryResult) => {
      if (generation === this.generation && this.view)
        void postMessage(this.view.webview, { ...base, result });
    };
    if (!target) {
      post({ status: "empty" });
      return;
    }
    post({ status: "loading" });
    try {
      const document = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === target.file);
      if (this.mode === "line" && document?.isDirty)
        throw new Error(vscode.l10n.t("Commit or discard changes before viewing line history."));
      const root = await this.git.root(target.file);
      if (
        this.mode === "line" &&
        (
          await this.git.run(root, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "HEAD",
            "--",
            this.git.relative(root, target.file),
          ])
        ).length
      )
        throw new Error(vscode.l10n.t("Commit or discard changes before viewing line history."));
      const limit = Math.max(
        10,
        Math.min(1000, Math.floor(config().get<number>("history.limit", 100))),
      );
      const commits = await this.git.history(
        root,
        target.file,
        limit,
        this.mode === "line" ? target.range : undefined,
        signal,
      );
      if (generation !== this.generation) return;
      this.root = root;
      commits.forEach((c) => this.commits.set(c.sha, c));
      post({ status: "ready", commits, truncated: commits.length === limit });
      // Limit simultaneous outbound requests, and never block history on avatar loading.
      for (let i = 0; i < commits.length && generation === this.generation; i += 6) {
        await Promise.all(
          commits.slice(i, i + 6).map(async (c) => {
            const avatar = await this.avatars.get(c.email);
            if (
              avatar &&
              config().get("gravatar.enabled", false) &&
              generation === this.generation &&
              this.view
            )
              void postMessage(this.view.webview, {
                type: "avatar",
                generation,
                sha: c.sha,
                avatar,
              });
          }),
        );
      }
    } catch (e) {
      if (!signal.aborted) post({ status: "error", notice: errorMessage(e) });
    }
  }
  private async message(value: unknown) {
    const m = parseHistoryRequest(value);
    if (!m) return;
    if (m.type === "ready" || m.type === "refresh") return this.refresh();
    if (m.type === "scope") {
      this.mode = m.mode;
      return this.refresh();
    }
    if (m.type === "pin") {
      this.pinned = this.pinned ? undefined : this.target();
      return this.refresh();
    }
    if (!("generation" in m) || m.generation !== this.generation) return;
    const commit = this.commits.get(m.sha);
    if (!commit) return;
    const root = this.root;
    const generation = this.generation;
    if (m.type === "copy") return vscode.env.clipboard.writeText(commit.sha);
    if (m.type === "remote") {
      const remote = (await this.git.run(root, ["remote", "get-url", "origin"])).trim();
      const url = remoteCommitUrl(remote, commit.sha);
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
      else
        void vscode.window.showInformationMessage(vscode.l10n.t("This remote is not supported."));
      return;
    }
    if (m.type === "details" || m.type === "diff") {
      const changes = this.changes.get(commit.sha) ?? (await this.git.details(root, commit));
      if (generation !== this.generation) return;
      this.changes.set(commit.sha, changes);
      if (m.type === "details") {
        if (!this.view) return;
        void postMessage(this.view.webview, {
          type: "details",
          generation,
          sha: commit.sha,
          changes,
        });
        return;
      }
      if (m.type !== "diff") return;
      const change = changes.find((c) => c.path === m.path);
      if (!change) return;
      await this.comparisons
        .create(root, commit, change, () => generation === this.generation)
        .open();
    }
  }
}

class Lenses implements vscode.CodeLensProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private cache = new Map<string, Promise<Blame[]>>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private git: Git) {}
  refresh() {
    this.cache.clear();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(), 300);
  }
  dispose() {
    clearTimeout(this.timer);
    this.changed.dispose();
  }
  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (!config().get("codeLens.enabled", true) || document.isDirty) return [];
    try {
      const root = await this.git.root(document.uri.fsPath);
      const head = await this.git.head(root);
      // Saved changes also shift line numbers; do not attribute them to HEAD lines.
      if (
        (
          await this.git.run(root, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "HEAD",
            "--",
            this.git.relative(root, document.uri.fsPath),
          ])
        ).length
      )
        return [];
      const key = `${document.uri.toString()}:${head}`;
      let blame = this.cache.get(key);
      if (!blame) {
        if (this.cache.size >= 30) this.cache.clear();
        blame = this.git.blame(root, document.uri.fsPath);
        this.cache.set(key, blame);
      }
      const [symbols, chunks] = await Promise.all([
        vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
          "vscode.executeDocumentSymbolProvider",
          document.uri,
        ),
        blame,
      ]);
      if (token.isCancellationRequested || document.isDirty) return [];
      const result: vscode.CodeLens[] = [];
      const seen = new Set<number>();
      const visit = (items: (vscode.DocumentSymbol | vscode.SymbolInformation)[]) =>
        items.forEach((s) => {
          const range = "range" in s ? s.range : s.location.range;
          if (
            [
              vscode.SymbolKind.Function,
              vscode.SymbolKind.Method,
              vscode.SymbolKind.Class,
              vscode.SymbolKind.Constructor,
            ].includes(s.kind) &&
            !seen.has(range.start.line)
          ) {
            const latest = chunks
              .filter(
                (c) =>
                  c.start <= range.end.line + 1 &&
                  c.start + c.count > range.start.line + 1 &&
                  !/^0+$/.test(c.sha),
              )
              .sort((a, b) => b.time - a.time)[0];
            if (latest) {
              seen.add(range.start.line);
              const days = Math.min(0, Math.round((latest.time * 1000 - Date.now()) / 86400000));
              const when = new Intl.RelativeTimeFormat(vscode.env.language, {
                numeric: "auto",
              }).format(days, "day");
              result.push(
                new vscode.CodeLens(new vscode.Range(range.start, range.start), {
                  title: vscode.l10n.t("Last changed by {0}, {1}", latest.author, when),
                  command: "gitInsights.fileHistory",
                }),
              );
            }
          }
          if ("children" in s) visit(s.children);
        });
      visit(symbols ?? []);
      return result;
    } catch {
      return [];
    }
  }
}

class RebaseEditor implements vscode.CustomTextEditorProvider {
  constructor(private context: vscode.ExtensionContext) {}
  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    panel.webview.html = html(panel.webview, this.context.extensionUri, "rebase");
    const update = () => {
      const todo = parseTodo(document.getText());
      return postMessage(panel.webview, {
        type: "todo",
        rows: todo.rows,
        supported: todo.supported,
        version: document.version,
        labels: labels(),
        locale: vscode.env.language,
      });
    };
    let applying = false;
    const listener = panel.webview.onDidReceiveMessage(async (value: unknown) => {
      const m = parseRebaseRequest(value);
      if (!m) return;
      if (m.type === "save" && applying) return;
      const ownsSave = m.type === "save";
      if (ownsSave) applying = true;
      try {
        if (m?.type === "ready") {
          await update();
          return;
        }
        if (m?.type === "text") {
          await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
          return;
        }
        if (m.type !== "save") return;
        if (m.version !== document.version) {
          await update();
          throw new Error(
            vscode.l10n.t("The document changed. Review the updated plan and try again."),
          );
        }
        const text = serializeTodo(parseTodo(document.getText()), m.rows);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          text,
        );
        if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save()))
          throw new Error(vscode.l10n.t("Could not save the rebase plan."));
        await update();
      } catch (e) {
        await postMessage(panel.webview, {
          type: "error",
          message: vscode.l10n.t(errorMessage(e)),
        });
      } finally {
        if (ownsSave) applying = false;
      }
    });
    const change = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === document) void update();
    });
    panel.onDidDispose(() => {
      listener.dispose();
      change.dispose();
    });
  }
}

export async function activate(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) return;
  const builtin = vscode.extensions.getExtension<BuiltinGitExtension>("vscode.git");
  const api = builtin ? (await builtin.activate()).getAPI(1) : undefined;
  const git = new Git(api?.git.path ?? "git");
  const avatars = new Avatars();
  const revisions = new Map<string, string>();
  const comparisons = createComparisonFactory(
    (root, revision, file) => git.content(root, revision, file),
    createComparisonPresenter(revisions),
  );
  const history = new History(context, git, avatars, comparisons);
  const lenses = new Lenses(git);
  const refresh = () => {
    lenses.refresh();
    history.schedule();
  };
  context.subscriptions.push(
    history,
    lenses,
    vscode.window.registerWebviewViewProvider("gitInsights.history", history),
    vscode.window.registerCustomEditorProvider("gitInsights.rebase", new RebaseEditor(context)),
    vscode.workspace.registerTextDocumentContentProvider("git-insights", {
      provideTextDocumentContent: (uri) => revisions.get(uri.toString()) ?? "",
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d.uri.scheme === "git-insights") revisions.delete(d.uri.toString());
    }),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, lenses),
    vscode.commands.registerCommand("gitInsights.fileHistory", () => history.show("file")),
    vscode.commands.registerCommand("gitInsights.lineHistory", () => history.show("line")),
    vscode.commands.registerCommand("gitInsights.refresh", refresh),
    vscode.commands.registerCommand("gitInsights.openRebase", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: vscode.l10n.t("Open Rebase Editor"),
      });
      if (picked?.[0])
        await vscode.commands.executeCommand("vscode.openWith", picked[0], "gitInsights.rebase");
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitInsights")) {
        avatars.clear();
        refresh();
      }
    }),
    vscode.workspace.onDidChangeTextDocument(() => lenses.refresh()),
    vscode.workspace.onDidSaveTextDocument(refresh),
  );
  if (api) {
    const watch = (repository: GitRepository) =>
      context.subscriptions.push(repository.state.onDidChange(refresh));
    api.repositories.forEach(watch);
    context.subscriptions.push(api.onDidOpenRepository(watch));
  }
}
