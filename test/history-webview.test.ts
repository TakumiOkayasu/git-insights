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

function mockAvatarImages() {
  const images: HTMLImageElement[] = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((...args) => {
    const element = create(...args);
    if (element instanceof HTMLImageElement) images.push(element);
    return element;
  });
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:avatar-${images.length}`);
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { images, createUrl, revokeUrl };
}

const avatarMessage = {
  type: "avatar",
  generation: 1,
  sha,
  avatar: "data:image/png;base64,AQID",
};

it("アバター未設定では著者名に依存しない装飾用のSVGを表示する", async () => {
  const { app, send } = await mount();
  const { createUrl } = mockAvatarImages();
  send({
    ...ready,
    result: {
      ...ready.result,
      commits: [commit, { ...commit, sha: "b".repeat(40), author: "" }],
    },
  });
  const avatars = app.querySelectorAll(".avatar");
  expect(avatars).toHaveLength(2);
  for (const avatar of avatars) {
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.textContent).toBe("");
    expect(avatar.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(avatar.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
    expect(avatar.querySelector("svg")?.getAttribute("focusable")).toBe("false");
    expect(avatar.querySelector("img")).toBeNull();
  }
  expect(avatars[0].innerHTML).toBe(avatars[1].innerHTML);
  expect(app.querySelector(".meta")!.textContent).toContain(commit.author);
  expect(createUrl).not.toHaveBeenCalled();
});

it("有効な画像は読み込み成功後だけSVGと置き換える", async () => {
  const { app, send } = await mount();
  const { images, createUrl, revokeUrl } = mockAvatarImages();
  send(ready);
  send(avatarMessage);
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  expect(app.querySelector(".avatar img")).toBeNull();
  expect(createUrl).toHaveBeenCalledOnce();
  expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect((createUrl.mock.calls[0][0] as Blob).type).toBe("image/png");
  images[0].dispatchEvent(new Event("load"));
  expect(app.querySelector(".avatar img")).toBe(images[0]);
  expect(images[0].alt).toBe("");
  expect(app.querySelector(".avatar svg")).toBeNull();
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:avatar-1");
});

it("画像の読み込みが失敗してもSVGを維持しBlob URLを解放する", async () => {
  const { app, send } = await mount();
  const { images, revokeUrl } = mockAvatarImages();
  send(ready);
  send(avatarMessage);
  images[0].dispatchEvent(new Event("error"));
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  expect(app.querySelector(".avatar img")).toBeNull();
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:avatar-1");
});

it.each([
  "",
  "https://example.invalid/tracker.png",
  "data:image/svg+xml;base64,AQID",
  "data:image/png;base64,%%%%",
])("不正なアバターを取得せずSVGを維持する: %s", async (avatar) => {
  const { app, send } = await mount();
  const { createUrl } = mockAvatarImages();
  send(ready);
  send({ ...avatarMessage, avatar });
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  expect(createUrl).not.toHaveBeenCalled();
});

it("画像の再取得では古い読み込みを破棄する", async () => {
  const { app, send } = await mount();
  const { images, revokeUrl } = mockAvatarImages();
  send(ready);
  send(avatarMessage);
  const staleLoad = images[0].onload!;
  send(avatarMessage);
  expect(revokeUrl).toHaveBeenCalledWith("blob:avatar-1");
  staleLoad.call(images[0], new Event("load"));
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  images[1].dispatchEvent(new Event("load"));
  expect(app.querySelector(".avatar img")).toBe(images[1]);
  expect(revokeUrl).toHaveBeenCalledTimes(2);
});

it("更新でアバターを未設定に戻し古い世代の画像を無視する", async () => {
  const { app, send } = await mount();
  const { images, createUrl } = mockAvatarImages();
  send(ready);
  send(avatarMessage);
  images[0].dispatchEvent(new Event("load"));
  const entry = app.querySelector("article");
  send({ ...ready, generation: 2, result: { status: "loading" } });
  send({ ...ready, generation: 2 });
  expect(app.querySelector("article")).toBe(entry);
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  send(avatarMessage);
  expect(createUrl).toHaveBeenCalledOnce();
  send({ ...avatarMessage, generation: 2 });
  images[1].dispatchEvent(new Event("load"));
  expect(app.querySelector(".avatar img")).toBe(images[1]);
});

it("表示先の変更時に読み込み中の画像を解放し新しいSVGへ反映しない", async () => {
  const { app, send } = await mount();
  const { images, revokeUrl } = mockAvatarImages();
  send(ready);
  send(avatarMessage);
  const staleLoad = images[0].onload!;
  send({ ...ready, generation: 2, context: { mode: "file", file: "/repo/two.ts" } });
  staleLoad.call(images[0], new Event("load"));
  expect(app.querySelector(".avatar svg")).not.toBeNull();
  expect(app.querySelector(".avatar img")).toBeNull();
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:avatar-1");
});

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
