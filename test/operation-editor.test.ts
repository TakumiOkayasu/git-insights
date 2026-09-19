import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { CommitOperations } from "../src/commit-operation";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("vscode", () => ({
  window: { createWebviewPanel: mocks.create },
  ViewColumn: { Active: -1 },
  l10n: { t: (value: string) => value },
  env: { language: "ja" },
  workspace: { isTrusted: true },
}));
import { OperationEditor } from "../src/operation-editor";
let receive: (value: unknown) => Promise<void>;
let dispose: () => void;
let panel: {
  dispose: ReturnType<typeof vi.fn>;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: (fn: typeof receive) => { dispose: ReturnType<typeof vi.fn> };
  };
  onDidDispose: (fn: () => void) => void;
};
beforeEach(() => {
  mocks.create.mockReset();
  panel = {
    dispose: vi.fn(() => dispose()),
    webview: {
      html: "",
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: (fn) => {
        receive = fn;
        return { dispose: vi.fn() };
      },
    },
    onDidDispose: (fn) => {
      dispose = fn;
    },
  };
  mocks.create.mockReturnValue(panel);
});
function fixture(execute = vi.fn().mockResolvedValue(undefined)) {
  const preview = {
    kind: "reword",
    root: "/repo",
    sha: "a".repeat(40),
    head: "b".repeat(40),
    branch: "refs/heads/main",
    message: "Old",
    rewritten: 2,
  };
  const prepare = vi.fn().mockResolvedValue({ preview, execute });
  const refresh = vi.fn();
  const editor = new OperationEditor(
    { prepare } as unknown as CommitOperations,
    (_view: vscode.Webview) => "HTML",
    refresh,
  );
  return { editor, preview, execute, refresh };
}
it("opens review in the editor and closing before execute does not mutate", async () => {
  const { editor, execute } = fixture();
  await editor.open("/repo", "reword", "a".repeat(40));
  expect(mocks.create).toHaveBeenCalledWith("gitInsights.operation", "Change commit message", -1, {
    retainContextWhenHidden: true,
  });
  await receive({ type: "ready" });
  await receive({ type: "cancel" });
  expect(execute).not.toHaveBeenCalled();
  expect(panel.dispose).toHaveBeenCalledOnce();
});
it("binds execution to the host plan, rejects malformed requests and prevents double execution", async () => {
  let finish: () => void = () => {};
  const execute = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { editor, preview, refresh } = fixture(execute);
  await editor.open("/repo", "reword", preview.sha);
  await receive({ type: "execute", message: 123 });
  expect(execute).not.toHaveBeenCalled();
  const first = receive({
    type: "execute",
    message: "New",
    root: "/other",
    sha: "c".repeat(40),
    kind: "cherry-pick",
  });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledWith("New"));
  await receive({ type: "execute", message: "Duplicate" });
  await receive({ type: "cancel" });
  expect(panel.dispose).not.toHaveBeenCalled();
  finish();
  await first;
  expect(execute).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      preview,
      result: { status: "success", message: "Operation completed." },
    }),
  );
});
it("reports failure without claiming success or retrying", async () => {
  const { editor, execute, refresh } = fixture(vi.fn().mockRejectedValue(new Error("conflict")));
  await editor.open("/repo", "reword", "a".repeat(40));
  await receive({ type: "execute", message: "New" });
  await receive({ type: "execute", message: "Retry" });
  expect(execute).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledOnce();
  expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ result: { status: "error", message: "conflict" } }),
  );
});
