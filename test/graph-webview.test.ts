// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountGraph } from "../src/webview/graph";
import type { GraphMessage } from "../src/graph-protocol";

const sha = "a".repeat(40);
const ready = {
  type: "graph",
  generation: 1,
  repository: "/repo-a",
  repositories: [{ id: "/repo-a", name: "repo-a" }],
  locale: "en",
  focus: "",
  state: {
    status: "ready",
    snapshot: {
      commits: [
        {
          sha,
          parents: [],
          author: "Test",
          email: "test@example.invalid",
          date: "2026-09-24T00:00:00Z",
          subject: "Subject",
          body: "",
        },
      ],
      refs: [],
      head: sha,
      branch: "main",
      changed: 0,
      remotes: [],
      truncated: false,
    },
  },
} satisfies GraphMessage;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("keeps both scroll axes after selecting a row and receiving a background refresh", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let receive: (event: MessageEvent) => void = () => {};
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
    if (type === "message") receive = listener as (event: MessageEvent) => void;
  });
  const send = (data: GraphMessage) => receive(new MessageEvent("message", { data }));
  const app = document.createElement("main");
  document.body.append(app);
  const post = vi.fn();
  mountGraph(app, post);
  const table = () => app.querySelector<HTMLElement>(".graph-table")!;
  send(ready);
  table().scrollTop = 840;
  table().scrollLeft = 120;
  app.querySelector<HTMLElement>("[data-sha]")!.click();
  expect(post).toHaveBeenLastCalledWith({ type: "inspect", generation: 1, sha });
  send({
    type: "selection",
    generation: 1,
    selection: 1,
    value: { title: "Subject", before: null, after: sha, changes: [] },
  });
  expect(table().scrollTop).toBe(840);
  expect(table().scrollLeft).toBe(120);

  // Git state notifications send loading before the replacement snapshot.
  send({ ...ready, generation: 2, state: { status: "loading" } });
  send({ ...ready, generation: 3, state: { status: "loading" } });
  send({ ...ready, generation: 3 });
  expect(table().scrollTop).toBe(840);
  expect(table().scrollLeft).toBe(120);
  expect(app.querySelector("[data-sha]")!.getAttribute("aria-selected")).toBe("true");
  expect(post).toHaveBeenLastCalledWith({ type: "inspect", generation: 3, sha });

  // Direct ready updates (and the comparison toggle) also rebuild the view.
  table().scrollTop = 560;
  send({ ...ready, generation: 4 });
  expect(table().scrollTop).toBe(560);
  expect(table().scrollLeft).toBe(120);
  app.querySelector<HTMLButtonElement>('button[aria-label="Compare"]')!.click();
  expect(table().scrollTop).toBe(560);
  expect(table().scrollLeft).toBe(120);

  // A different history must start at the top, including after loading.
  const focused = { ...ready, focus: "refs/heads/topic", generation: 5 };
  send({ ...focused, state: { status: "loading" } });
  send(focused);
  expect(table().scrollTop).toBe(0);
  expect(table().scrollLeft).toBe(0);
  table().scrollTop = 280;
  table().scrollLeft = 80;
  const other = { ...focused, repository: "/repo-b", generation: 6 };
  send({ ...other, state: { status: "loading" } });
  send(other);
  expect(table().scrollTop).toBe(0);
  expect(table().scrollLeft).toBe(0);
});

function graphHarness() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  let receive: (event: MessageEvent) => void = () => {};
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
    if (type === "message") receive = listener as (event: MessageEvent) => void;
  });
  const app = document.createElement("main");
  document.body.append(app);
  const post = vi.fn();
  mountGraph(app, post);
  return {
    app,
    post,
    send: (data: GraphMessage) => receive(new MessageEvent("message", { data })),
  };
}

it("retains rows, canvas, search focus and inspector throughout unchanged refreshes", () => {
  const { app, send, post } = graphHarness();
  send(ready);
  const row = app.querySelector<HTMLElement>("[data-sha]")!;
  row.click();
  const selection = {
    type: "selection",
    generation: 1,
    selection: 1,
    value: {
      title: "Subject",
      before: null,
      after: sha,
      changes: [{ path: "file.txt", status: "A", added: "1", deleted: "0" }],
    },
  } satisfies GraphMessage;
  send(selection);
  const canvas = app.querySelector("canvas");
  const inspector = app.querySelector(".graph-inspector");
  const file = app.querySelector<HTMLButtonElement>(".changed-file")!;
  const search = app.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.focus();
  search.value = "Subject";
  send({ ...ready, generation: 2, state: { status: "loading" } });
  expect(app.querySelector("[data-sha]")).toBe(row);
  expect(app.querySelector("canvas")).toBe(canvas);
  expect(app.querySelector(".graph-inspector")).toBe(inspector);
  expect(app.getAttribute("aria-busy")).toBe("true");
  expect(file.disabled).toBe(true);
  const before = post.mock.calls.length;
  row.click();
  file.click();
  expect(post).toHaveBeenCalledTimes(before);
  send({ ...ready, generation: 2 });
  expect(app.querySelector("[data-sha]")).toBe(row);
  expect(document.activeElement).toBe(search);
  expect(search.value).toBe("Subject");
  expect(post).toHaveBeenLastCalledWith({ type: "inspect", generation: 2, sha });
  expect(file.disabled).toBe(true);
  send({ ...selection, generation: 2, selection: 4 });
  expect(app.querySelector(".changed-file")).toBe(file);
  expect(file.disabled).toBe(false);
  file.click();
  expect(post).toHaveBeenLastCalledWith({
    type: "diff",
    generation: 2,
    selection: 4,
    path: "file.txt",
  });
});

it("renders changed data and clears old contents when switching repository", () => {
  const { app, send } = graphHarness();
  send(ready);
  const old = app.querySelector("[data-sha]");
  app.querySelector<HTMLElement>(".graph-table")!.scrollTop = 280;
  send({ ...ready, generation: 2, state: { status: "loading" } });
  send({
    ...ready,
    generation: 2,
    state: {
      status: "ready",
      snapshot: {
        ...ready.state.snapshot,
        commits: [{ ...ready.state.snapshot.commits[0], subject: "Updated subject" }],
      },
    },
  });
  expect(app.querySelector("[data-sha]")).not.toBe(old);
  expect(app.textContent).toContain("Updated subject");
  expect(app.querySelector<HTMLElement>(".graph-table")!.scrollTop).toBe(280);
  send({ ...ready, repository: "/repo-b", generation: 3, state: { status: "loading" } });
  expect(app.querySelector("[data-sha]")).toBeNull();
  expect(app.textContent).not.toContain("Updated subject");
  send({ ...ready, generation: 2 });
  expect(app.querySelector("[data-sha]")).toBeNull();
});

it("keeps the previous graph on refresh error while permitting retry", () => {
  const { app, send, post } = graphHarness();
  send(ready);
  const row = app.querySelector("[data-sha]");
  send({ ...ready, generation: 2, state: { status: "loading" } });
  send({ ...ready, generation: 2, state: { status: "error", message: "Git failed" } });
  expect(app.querySelector("[data-sha]")).toBe(row);
  expect(app.querySelector('[role="alert"]')?.textContent).toBe("Git failed");
  const refresh = app.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
  expect(refresh.disabled).toBe(false);
  refresh.click();
  expect(post).toHaveBeenLastCalledWith({ type: "refresh" });
  send({ ...ready, generation: 3 });
  expect(app.querySelector('[role="alert"]')?.textContent).toBe("");
  expect(app.getAttribute("aria-busy")).toBe("false");
});
