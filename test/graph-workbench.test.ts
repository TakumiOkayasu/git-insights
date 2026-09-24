import { expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { Git } from "../src/git";
import type { ComparisonFactory } from "../src/git-comparison";
import type { BuiltinGitApi } from "../src/vscode-git";
import type { RepositorySnapshot, RevisionSelection } from "../src/repository";
import { parseGraphMessage, type GraphMessage } from "../src/graph-protocol";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  snapshot: vi.fn(),
  inspect: vi.fn(),
  compare: vi.fn(),
  fetch: vi.fn(),
  pick: vi.fn(),
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: mocks.execute },
  env: { language: "en" },
  l10n: { t: (value: string) => value },
  ProgressLocation: { Notification: 1 },
  window: {
    withProgress: (_options: unknown, task: () => Promise<void>) => task(),
    showQuickPick: mocks.pick,
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("../src/repository", () => ({
  createRepository: () => ({
    snapshot: mocks.snapshot,
    inspect: mocks.inspect,
    compare: mocks.compare,
    fetch: mocks.fetch,
  }),
}));
import { GraphWorkbench } from "../src/graph-workbench";

const emptySnapshot = {
  commits: [],
  refs: [],
  head: null,
  branch: "main",
  changed: 0,
  remotes: [],
  truncated: false,
} satisfies RepositorySnapshot;

const checkedPostMessage = () =>
  vi.fn(async (message: GraphMessage) => {
    if (!parseGraphMessage(message)) throw new Error("GraphWorkbench posted an invalid message");
    return true;
  });

it("focuses the panel and refreshes a recreated view with the selected repository", async () => {
  mocks.snapshot.mockResolvedValue(emptySnapshot);
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
        postMessage: checkedPostMessage(),
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
  mocks.snapshot.mockResolvedValue({
    ...emptySnapshot,
    commits: [
      {
        sha,
        parents: [],
        author: "Test Author",
        email: "test@example.invalid",
        date: "2026-09-21T00:00:00Z",
        subject: "Subject",
        body: "",
      },
    ],
    head: sha,
  });
  await graph.refresh();
  const last = second.view.webview.postMessage.mock.calls.at(-1)![0];
  if (last.type !== "graph") throw new Error("Expected a graph message");
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
  for (const [message] of [
    ...first.view.webview.postMessage.mock.calls,
    ...second.view.webview.postMessage.mock.calls,
  ])
    expect(parseGraphMessage(message)).toEqual(message);
  graph.dispose();
});

it("rejects graph messages when a snapshot field is missing", () => {
  expect(
    parseGraphMessage({
      type: "graph",
      repositories: [],
      repository: "/repo",
      generation: 1,
      locale: "en",
      focus: "",
      state: {
        status: "ready",
        snapshot: { ...emptySnapshot, truncated: undefined },
      },
    }),
  ).toBeUndefined();
});

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const snapshotWithCommits: RepositorySnapshot = {
  ...emptySnapshot,
  commits: [shaA, shaB].map((sha) => ({
    sha,
    parents: [],
    author: "Test Author",
    email: "test@example.invalid",
    date: "2026-09-21T00:00:00Z",
    subject: "Subject",
    body: "",
  })),
  head: shaA,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function selection(after: string): RevisionSelection {
  return { before: null, after, title: "Subject", changes: [] };
}

function fixture() {
  mocks.snapshot.mockResolvedValue(snapshotWithCommits);
  const api = {
    repositories: [{ rootUri: { fsPath: "/repo-a" } }, { rootUri: { fsPath: "/repo-b" } }],
  } as unknown as BuiltinGitApi;
  const git = { run: vi.fn() };
  const graph = new GraphWorkbench(
    git as unknown as Git,
    api,
    {} as ComparisonFactory,
    () => "graph HTML",
    vi.fn().mockResolvedValue(undefined),
  );
  const createView = () => {
    let receive: (value: unknown) => void = () => {};
    let dispose: () => void = () => {};
    const view = {
      visible: true,
      show: vi.fn(),
      webview: {
        html: "",
        postMessage: checkedPostMessage(),
        onDidReceiveMessage: (fn: typeof receive) => {
          receive = fn;
          return { dispose: vi.fn() };
        },
      },
      onDidChangeVisibility: () => ({ dispose: vi.fn() }),
      onDidDispose: (fn: typeof dispose) => {
        dispose = fn;
        return { dispose: vi.fn() };
      },
    };
    graph.resolveWebviewView(view as unknown as vscode.WebviewView);
    return {
      view,
      receive: (message: unknown) => receive(message),
      dispose: () => dispose(),
      generation: () => {
        const message = view.webview.postMessage.mock.calls.at(-1)?.[0];
        if (message?.type !== "graph") throw new Error("Expected graph message");
        return message.generation;
      },
    };
  };
  return { graph, git, createView };
}

it("ignores late inspect success and compare failure after changing repositories", async () => {
  const { graph, createView } = fixture();
  const view = createView();
  await graph.show("/repo-a");
  const generation = view.generation();
  const inspect = deferred<RevisionSelection>();
  const compare = deferred<RevisionSelection>();
  mocks.inspect.mockReturnValueOnce(inspect.promise);
  mocks.compare.mockReturnValueOnce(compare.promise);
  view.receive({ type: "inspect", generation, sha: shaA });
  view.receive({ type: "compare", generation, base: shaA, target: shaB, commonBase: false });
  view.receive({ type: "repository", id: "/repo-b" });
  await vi.waitFor(() =>
    expect(view.view.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        repository: "/repo-b",
        state: expect.objectContaining({ status: "ready" }),
      }),
    ),
  );
  const count = view.view.webview.postMessage.mock.calls.length;
  inspect.resolve(selection(shaA));
  compare.reject(new Error("stale comparison"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(view.view.webview.postMessage).toHaveBeenCalledTimes(count);
  graph.dispose();
});

it("ignores an earlier selection failure but shows the current failure", async () => {
  const { graph, createView } = fixture();
  const view = createView();
  await graph.show("/repo-a");
  const generation = view.generation();
  const old = deferred<RevisionSelection>();
  const current = deferred<RevisionSelection>();
  mocks.inspect.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  view.receive({ type: "inspect", generation, sha: shaA });
  view.receive({ type: "inspect", generation, sha: shaB });
  old.reject(new Error("old selection"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(view.view.webview.postMessage).not.toHaveBeenCalledWith({
    type: "graphError",
    message: "old selection",
  });
  current.reject(new Error("current selection"));
  await vi.waitFor(() =>
    expect(view.view.webview.postMessage).toHaveBeenLastCalledWith({
      type: "graphError",
      message: "current selection",
    }),
  );
  graph.dispose();
});

it("shows a current fetch failure after its own refresh", async () => {
  const { graph, createView } = fixture();
  const view = createView();
  await graph.show("/repo-a");
  mocks.fetch.mockRejectedValueOnce(new Error("fetch failed"));
  view.receive({ type: "fetch" });
  await vi.waitFor(() =>
    expect(view.view.webview.postMessage).toHaveBeenLastCalledWith({
      type: "graphError",
      message: "fetch failed",
    }),
  );
  graph.dispose();
});

it("shows a current checkout failure after its own refresh", async () => {
  const { graph, git, createView } = fixture();
  const view = createView();
  await graph.show("/repo-a");
  mocks.pick.mockResolvedValueOnce("topic");
  git.run.mockRejectedValueOnce(new Error("switch failed"));
  view.receive({ type: "checkout" });
  await vi.waitFor(() =>
    expect(view.view.webview.postMessage).toHaveBeenLastCalledWith({
      type: "graphError",
      message: "switch failed",
    }),
  );
  graph.dispose();
});

it("ignores a fetch failure after an external refresh", async () => {
  const { graph, createView } = fixture();
  const view = createView();
  await graph.show("/repo-a");
  const fetch = deferred<void>();
  mocks.fetch.mockReturnValueOnce(fetch.promise);
  view.receive({ type: "fetch" });
  await graph.refresh();
  fetch.reject(new Error("stale fetch"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(view.view.webview.postMessage).not.toHaveBeenCalledWith({
    type: "graphError",
    message: "stale fetch",
  });
  graph.dispose();
});

it("does not send a late selection failure to a recreated or disposed view", async () => {
  const { graph, createView } = fixture();
  const first = createView();
  await graph.show("/repo-a");
  const old = deferred<RevisionSelection>();
  mocks.inspect.mockReturnValueOnce(old.promise);
  first.receive({ type: "inspect", generation: first.generation(), sha: shaA });
  first.dispose();
  const second = createView();
  second.receive({ type: "ready" });
  await vi.waitFor(() =>
    expect(second.view.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: expect.objectContaining({ status: "ready" }) }),
    ),
  );
  old.reject(new Error("disposed view"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(first.view.webview.postMessage).not.toHaveBeenCalledWith({
    type: "graphError",
    message: "disposed view",
  });
  expect(second.view.webview.postMessage).not.toHaveBeenCalledWith({
    type: "graphError",
    message: "disposed view",
  });
  const later = deferred<RevisionSelection>();
  mocks.compare.mockReturnValueOnce(later.promise);
  second.receive({
    type: "compare",
    generation: second.generation(),
    base: shaA,
    target: shaB,
    commonBase: false,
  });
  graph.dispose();
  later.reject(new Error("disposed provider"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(second.view.webview.postMessage).not.toHaveBeenCalledWith({
    type: "graphError",
    message: "disposed provider",
  });
});
