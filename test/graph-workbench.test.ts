import { expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { Git } from "../src/git";
import type { ComparisonFactory } from "../src/git-comparison";
import type { BuiltinGitApi } from "../src/vscode-git";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: mocks.execute },
  env: { language: "en" },
  l10n: { t: (value: string) => value },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("../src/repository", () => ({
  createRepository: () => ({ snapshot: mocks.snapshot }),
}));
import { GraphWorkbench } from "../src/graph-workbench";

it("focuses the panel and refreshes a recreated view with the selected repository", async () => {
  mocks.snapshot.mockResolvedValue({ commits: [], refs: [], head: null });
  const api = {
    repositories: [{ rootUri: { fsPath: "/repo-a" } }, { rootUri: { fsPath: "/repo-b" } }],
  } as unknown as BuiltinGitApi;
  const openOperation = vi.fn().mockResolvedValue(undefined);
  const graph = new GraphWorkbench(
    {} as Git,
    api,
    {} as ComparisonFactory,
    () => "graph HTML",
    openOperation,
  );
  const createView = () => {
    let receive: (value: unknown) => void = () => {};
    let visibility: () => void = () => {};
    let dispose: () => void = () => {};
    const listener = { dispose: vi.fn() };
    const visibleListener = { dispose: vi.fn() };
    const view = {
      visible: true,
      show: vi.fn(),
      webview: {
        html: "",
        postMessage: vi.fn().mockResolvedValue(true),
        onDidReceiveMessage: (fn: typeof receive) => {
          receive = fn;
          return listener;
        },
      },
      onDidChangeVisibility: (fn: typeof visibility) => {
        visibility = fn;
        return visibleListener;
      },
      onDidDispose: (fn: typeof dispose) => {
        dispose = fn;
        return { dispose: vi.fn() };
      },
    };
    graph.resolveWebviewView(view as unknown as vscode.WebviewView);
    return {
      view,
      listener,
      visibleListener,
      receive: (value: unknown) => receive(value),
      visibility: () => visibility(),
      dispose: () => dispose(),
    };
  };
  const first = createView();
  await graph.show("/repo-b");
  expect(mocks.execute).toHaveBeenCalledWith("gitInsights.graph.focus");
  expect(first.view.show).toHaveBeenCalled();
  expect(first.view.webview.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "graph",
      repository: "/repo-b",
      state: expect.objectContaining({ status: "ready" }),
    }),
  );
  first.view.visible = false;
  mocks.snapshot.mockClear();
  await graph.refresh();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  first.dispose();
  expect(first.listener.dispose).toHaveBeenCalled();
  expect(first.visibleListener.dispose).toHaveBeenCalled();
  const second = createView();
  second.receive({ type: "ready" });
  await vi.waitFor(() =>
    expect(second.view.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        repository: "/repo-b",
        state: expect.objectContaining({ status: "ready" }),
      }),
    ),
  );
  second.view.visible = false;
  mocks.snapshot.mockClear();
  second.view.visible = true;
  second.visibility();
  await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalled());
  const sha = "a".repeat(40);
  mocks.snapshot.mockResolvedValue({ commits: [{ sha }], refs: [], head: sha });
  await graph.refresh();
  const last = second.view.webview.postMessage.mock.calls.at(-1)![0];
  second.receive({ type: "operation", generation: last.generation - 1, sha, kind: "reword" });
  second.receive({
    type: "operation",
    generation: last.generation,
    sha: "b".repeat(40),
    kind: "cherry-pick",
  });
  second.receive({ type: "operation", generation: last.generation, sha, kind: "reset" });
  expect(openOperation).not.toHaveBeenCalled();
  second.receive({ type: "operation", generation: last.generation, sha, kind: "reword" });
  await vi.waitFor(() => expect(openOperation).toHaveBeenCalledWith("/repo-b", "reword", sha));
  expect(openOperation).toHaveBeenCalledOnce();
  graph.dispose();
});
