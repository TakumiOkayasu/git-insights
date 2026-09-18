import { describe, expect, it } from "vitest";
import {
  parseHistoryRequest,
  parseRebaseRequest,
  parseHostMessage,
  type HostMessage,
} from "../src/protocol";
import { translateLabels } from "../src/labels";
const sha = "a".repeat(40);
const localized = { labels: translateLabels((key) => key), locale: "ja" };
describe("untrusted webview requests", () => {
  it("requires a revision, generation and path for diff actions", () => {
    expect(parseHistoryRequest({ type: "diff", sha, generation: 1, path: "日本語.ts" })).toEqual({
      type: "diff",
      sha,
      generation: 1,
      path: "日本語.ts",
    });
    for (const v of [
      null,
      [],
      { type: "diff", sha, generation: 1 },
      { type: "diff", sha: "--help", generation: 1, path: "a" },
      { type: "copy", sha, generation: -1 },
      { type: "scope", mode: "other" },
      { type: "save", rows: [] },
    ])
      expect(parseHistoryRequest(v)).toBeUndefined();
  });
  it("validates every rebase row before it reaches the document", () => {
    const request = {
      type: "save",
      version: 2,
      rows: [{ id: 0, action: "pick", sha: "abcdef1", message: "first" }],
    };
    expect(parseRebaseRequest(request)).toEqual(request);
    for (const rows of [
      [null],
      [{ id: 0, action: "exec", sha: "abcdef1", message: "bad" }],
      [{ id: -1, action: "pick", sha: "abcdef1", message: "" }],
    ])
      expect(parseRebaseRequest({ ...request, rows })).toBeUndefined();
    expect(parseRebaseRequest({ ...request, version: NaN })).toBeUndefined();
  });
});
describe("host messages", () => {
  const history = {
    type: "history",
    ...localized,
    generation: 1,
    pinned: false,
    context: { mode: "line", file: "a.ts", range: [1, 2] },
    result: { status: "ready", commits: [], truncated: false },
  } satisfies HostMessage;
  it("accepts valid presentation states", () => {
    expect(parseHostMessage(history)).toEqual(history);
    for (const result of [
      { status: "empty" },
      { status: "loading" },
      { status: "error", notice: "Git failed" },
    ])
      expect(parseHostMessage({ ...history, result })).toBeDefined();
  });
  it("rejects impossible ranges and incomplete success or localization data", () => {
    for (const context of [
      { mode: "line", file: "a.ts" },
      { mode: "line", file: "a.ts", range: [2, 1] },
      { mode: "line", file: "a.ts", range: [0, 1] },
    ])
      expect(parseHostMessage({ ...history, context })).toBeUndefined();
    expect(parseHostMessage({ ...history, result: { status: "ready" } })).toBeUndefined();
    expect(parseHostMessage({ ...history, labels: {} })).toBeUndefined();
    expect(parseHostMessage({ ...history, locale: "invalid_locale" })).toBeUndefined();
  });
  it("round-trips each supported host message", () => {
    const messages: HostMessage[] = [
      history,
      { type: "todo", ...localized, version: 1, supported: true, rows: [] },
      { type: "details", generation: 1, sha, changes: [] },
      { type: "avatar", generation: 1, sha, avatar: "data:image/png;base64,AQID" },
      { type: "error", message: "Save failed" },
    ];
    for (const message of messages)
      expect(parseHostMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });
});
