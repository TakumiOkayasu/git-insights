// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { translateLabels } from "../src/labels";
import type { HistoryMessage } from "../src/protocol";

const sha = "a".repeat(40);
const commit = {
  sha,
  parents: [],
  author: "Test",
  email: "test@example.invalid",
  date: "2026-09-24T00:00:00Z",
  subject: "Subject",
  body: "Body",
};
const ready = {
  type: "history",
  generation: 1,
  context: { mode: "file", file: "/repo/one.ts" },
  pinned: false,
  labels: translateLabels((key) => key),
  locale: "en",
  result: { status: "ready", commits: [commit], truncated: false },
} satisfies HistoryMessage;

beforeEach(() => {
  vi.resetModules();
  document.body.replaceChildren();
  document.body.dataset.mode = "history";
  const app = document.createElement("main");
  app.id = "app";
  document.body.append(app);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete document.body.dataset.mode;
});

async function mount() {
  let receive: (event: MessageEvent) => void = () => {};
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
    if (type === "message") receive = listener as (event: MessageEvent) => void;
  });
  const post = vi.fn();
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: post }));
  await import("../src/webview/main");
  return {
    app: document.getElementById("app")!,
    post,
    send: (data: unknown) => receive(new MessageEvent("message", { data })),
  };
}

it("retains expanded details and row identity through an unchanged refresh", async () => {
  const { app, post, send } = await mount();
  send(ready);
  const entry = app.querySelector("article")!;
  const subject = app.querySelector<HTMLButtonElement>(".subject")!;
  subject.click();
  expect(post).toHaveBeenLastCalledWith({ type: "details", generation: 1, sha });
  send({ type: "details", generation: 1, sha, changes: [] });
  expect(app.querySelector(".details")!.textContent).toContain("Body");

  send({ ...ready, generation: 2, result: { status: "loading" } });
  expect(app.querySelector("article")).toBe(entry);
  expect(app.querySelector(".status")!.textContent).toBe("Loading…");
  expect(subject.disabled).toBe(true);
  expect(app.querySelector<HTMLButtonElement>(".hash")!.disabled).toBe(true);
  const count = post.mock.calls.length;
  subject.click();
  expect(post).toHaveBeenCalledTimes(count);
  app.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click();
  expect(post).toHaveBeenLastCalledWith({ type: "refresh" });

  send({ ...ready, generation: 2 });
  expect(app.querySelector("article")).toBe(entry);
  expect(app.querySelector(".details")!.textContent).toContain("Body");
  expect(app.querySelector<HTMLElement>(".details")!.hidden).toBe(false);
  expect(subject.disabled).toBe(false);
  expect(app.querySelector(".status")!.textContent).toBe("");
  app.querySelector<HTMLButtonElement>(".hash")!.click();
  expect(post).toHaveBeenLastCalledWith({ type: "copy", generation: 2, sha });
});

it("retries an unfinished detail request and discards stale responses", async () => {
  const { app, post, send } = await mount();
  send(ready);
  app.querySelector<HTMLButtonElement>(".subject")!.click();
  send({ ...ready, generation: 2, result: { status: "loading" } });
  send({ type: "details", generation: 1, sha, changes: [] });
  expect(app.querySelector(".details")!.textContent).toBe("Loading…");
  send({ ...ready, generation: 2 });
  expect(post).toHaveBeenLastCalledWith({ type: "details", generation: 2, sha });
  send({ type: "details", generation: 2, sha, changes: [] });
  expect(app.querySelector(".details")!.textContent).toContain("Body");
});

it("clears old rows for a new context, changed history, or an error", async () => {
  const { app, send } = await mount();
  send(ready);
  const entry = app.querySelector("article")!;
  send({
    ...ready,
    generation: 2,
    context: { mode: "file", file: "/repo/two.ts" },
    result: { status: "loading" },
  });
  expect(app.querySelector("article")).toBeNull();
  send({ ...ready, generation: 2, context: { mode: "file", file: "/repo/two.ts" } });
  expect(app.querySelector("article")).not.toBe(entry);
  const next = app.querySelector("article")!;
  send({
    ...ready,
    generation: 3,
    context: { mode: "file", file: "/repo/two.ts" },
    result: { status: "loading" },
  });
  expect(app.querySelector("article")).toBe(next);
  send({
    ...ready,
    generation: 3,
    context: { mode: "file", file: "/repo/two.ts" },
    result: { status: "ready", commits: [{ ...commit, subject: "Changed" }], truncated: false },
  });
  expect(app.querySelector("article")).not.toBe(next);
  send({
    ...ready,
    generation: 4,
    context: { mode: "file", file: "/repo/two.ts" },
    result: { status: "error", notice: "Git unavailable" },
  });
  expect(app.querySelector("article")).toBeNull();
  expect(app.querySelector(".status")!.textContent).toBe("Git unavailable");
});

it("does not retain rows across pin, locale, or label changes", async () => {
  const { app, send } = await mount();
  let generation = 0;
  const variants: Partial<HistoryMessage>[] = [
    { pinned: true },
    { locale: "fr" },
    { labels: { ...ready.labels, Refresh: "Reload" } },
  ];
  for (const variant of variants) {
    send({ ...ready, generation: ++generation });
    expect(app.querySelector("article")).not.toBeNull();
    send({ ...ready, ...variant, generation: ++generation, result: { status: "loading" } });
    expect(app.querySelector("article")).toBeNull();
  }
});

it("restores the empty-history notice after an unchanged refresh", async () => {
  const { app, send } = await mount();
  const empty = {
    ...ready,
    result: { status: "ready", commits: [], truncated: false },
  } satisfies HistoryMessage;
  send(empty);
  const timeline = app.querySelector(".timeline");
  expect(app.querySelector(".status")!.textContent).toBe("No history found.");
  send({ ...empty, generation: 2, result: { status: "loading" } });
  expect(app.querySelector(".timeline")).toBe(timeline);
  expect(app.querySelector(".status")!.textContent).toBe("Loading…");
  send({ ...empty, generation: 2 });
  expect(app.querySelector(".timeline")).toBe(timeline);
  expect(app.querySelector(".status")!.textContent).toBe("No history found.");
});
