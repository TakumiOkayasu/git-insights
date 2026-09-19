import * as vscode from "vscode";
import type { CommitOperations, OperationKind } from "./commit-operation";

export class OperationEditor implements vscode.Disposable {
  private readonly panels = new Set<vscode.WebviewPanel>();
  constructor(
    private readonly operations: CommitOperations,
    private readonly html: (view: vscode.Webview) => string,
    private readonly refresh: () => void,
  ) {}
  async open(root: string, kind: OperationKind, sha: string) {
    const operation = await this.operations.prepare(root, kind, sha);
    const panel = vscode.window.createWebviewPanel(
      "gitInsights.operation",
      kind === "cherry-pick" ? "Cherry-pick" : vscode.l10n.t("Change commit message"),
      vscode.ViewColumn.Active,
      { retainContextWhenHidden: true },
    );
    this.panels.add(panel);
    let attempted = false;
    let running = false;
    let result: { status: "success" | "error"; message: string } | undefined;
    const send = () =>
      panel.webview.postMessage({
        type: "operation",
        preview: operation.preview,
        locale: vscode.env.language,
        attempted,
        running,
        result,
      });
    const listener = panel.webview.onDidReceiveMessage(async (value: unknown) => {
      if (!value || typeof value !== "object" || !("type" in value)) return;
      if (value.type === "ready") {
        await send();
        return;
      }
      if (value.type === "cancel" && !running) {
        panel.dispose();
        return;
      }
      if (
        value.type !== "execute" ||
        attempted ||
        !("message" in value) ||
        typeof value.message !== "string"
      )
        return;
      if (!vscode.workspace.isTrusted) return;
      attempted = true;
      running = true;
      await send();
      try {
        await operation.execute(value.message);
        result = { status: "success", message: vscode.l10n.t("Operation completed.") };
      } catch (error) {
        result = {
          status: "error",
          message: vscode.l10n.t(error instanceof Error ? error.message : String(error)),
        };
      } finally {
        running = false;
        this.refresh();
        await send();
        if (!this.panels.has(panel)) {
          if (result?.status === "error") void vscode.window.showErrorMessage(result.message);
          else void vscode.window.showInformationMessage(vscode.l10n.t("Operation completed."));
        }
      }
    });
    panel.onDidDispose(() => {
      listener.dispose();
      this.panels.delete(panel);
    });
    panel.webview.html = this.html(panel.webview);
  }
  dispose() {
    for (const panel of this.panels) panel.dispose();
    this.panels.clear();
  }
}
