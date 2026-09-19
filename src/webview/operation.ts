import type { OperationPreview } from "../commit-operation";
import { isOperationKind } from "../commit-operation-kind";

export function mountOperation(app: HTMLElement, post: (value: unknown) => void) {
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  let message: HTMLTextAreaElement | undefined;
  window.addEventListener("message", (event) => {
    const state = event.data;
    if (!state || state.type !== "operation" || !state.preview) return;
    const preview: OperationPreview = state.preview;
    if (!isOperationKind(preview.kind)) return;
    const ja = typeof state.locale === "string" && state.locale.startsWith("ja");
    const t = (jp: string, en: string) => (ja ? jp : en);
    const draft = message?.value ?? preview.message;
    app.className = "operation-editor";
    app.replaceChildren();
    app.append(
      element(
        "h1",
        preview.kind === "cherry-pick"
          ? "Cherry-pick"
          : t("コミットメッセージを変更", "Change commit message"),
      ),
    );
    const details = element("dl");
    for (const [label, value] of [
      [t("リポジトリ", "Repository"), preview.root],
      [t("対象コミット", "Selected commit"), preview.sha],
      [t("適用先ブランチ", "Destination branch"), preview.branch.replace(/^refs\/heads\//, "")],
      ["HEAD", preview.head],
    ])
      details.append(element("dt", label), element("dd", value));
    app.append(details);
    if (preview.kind === "reword") {
      app.append(
        element(
          "p",
          t(
            `選択したコミットと後続の計${preview.rewritten}件のSHAが変わります。共有済みの履歴を書き換える場合は共同作業者との調整が必要です。`,
            `This rewrites ${preview.rewritten} commits, including descendants. Coordinate with collaborators before rewriting shared history.`,
          ),
        ),
      );
      const label = element("label", t("新しいコミットメッセージ", "New commit message"));
      label.htmlFor = "commit-message";
      message = element("textarea");
      message.id = label.htmlFor;
      message.rows = 10;
      message.maxLength = 100_000;
      message.value = draft;
      message.disabled = state.attempted;
      app.append(label, message);
    } else {
      app.append(element("pre", preview.message));
    }
    app.append(
      element(
        "p",
        t(
          "実行前に閉じると変更はありません。実行後に閉じてもGit処理は中止されません。",
          "Closing before execution makes no changes. Closing after execution does not abort Git.",
        ),
      ),
    );
    const controls = element("div");
    const execute = element("button", t("確認して実行", "Confirm and execute"));
    execute.type = "button";
    execute.disabled = state.attempted;
    execute.onclick = () => {
      execute.disabled = true;
      post({ type: "execute", message: message?.value ?? "" });
    };
    const cancel = element("button", t("閉じる", "Close"));
    cancel.type = "button";
    cancel.disabled = state.running;
    cancel.onclick = () => post({ type: "cancel" });
    controls.append(execute, cancel);
    app.append(controls);
    const status = element(
      "p",
      state.running ? t("実行中…", "Running…") : (state.result?.message ?? ""),
    );
    status.setAttribute("role", state.result?.status === "error" ? "alert" : "status");
    app.append(status);
    if (state.result?.status === "error") {
      const command = preview.kind === "cherry-pick" ? "cherry-pick" : "rebase";
      app.append(
        element(
          "p",
          t(
            "対象リポジトリで git status を確認してください。処理が停止中なら競合を解消してステージ後に継続するか、中止してください。自動再実行はしません。",
            "Run git status in this repository. If an operation is paused, resolve and stage conflicts before continuing, or abort. Nothing is retried automatically.",
          ),
        ),
        element("pre", `git status\ngit ${command} --continue\ngit ${command} --abort`),
      );
    }
  });
}
