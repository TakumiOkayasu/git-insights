import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Git } from "../src/git";
import { LineBlame } from "../src/line-blame";

const host = vi.hoisted(() => ({
  enabled: true,
  setDecorations: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("vscode", () => {
  const event = () => ({ dispose() {} });
  const end = { line: 0, character: 8 };
  class MarkdownString {
    value = "";
    appendMarkdown(text: string) {
      this.value += text;
      return this;
    }
    appendText(text: string) {
      this.value += text;
      return this;
    }
  }
  const editor = {
    selection: { isEmpty: true, active: { line: 0 } },
    document: {
      uri: { scheme: "file", fsPath: "/repo/file.ts", toString: () => "file:///repo/file.ts" },
      version: 1,
      isClosed: false,
      getText: () => "contents",
      lineAt: () => ({ range: { end } }),
    },
    setDecorations: host.setDecorations,
  };
  return {
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      createTextEditorDecorationType: () => ({ dispose: host.dispose }),
      onDidChangeActiveTextEditor: event,
      onDidChangeTextEditorSelection: event,
    },
    workspace: {
      getConfiguration: () => ({ get: () => host.enabled }),
      onDidChangeTextDocument: event,
      onDidCloseTextDocument: event,
    },
    ThemeColor: class {},
    DecorationRangeBehavior: { ClosedClosed: 0 },
    MarkdownString,
    Range: class {
      constructor(
        public start: unknown,
        public end: unknown,
      ) {}
    },
    env: { language: "en" },
    l10n: { t: (text: string) => text },
  };
});

let blame: LineBlame;
const sha = "a".repeat(40);
const commit = {
  sha,
  parents: [],
  author: "Test Author",
  email: "author@example.invalid",
  date: "2026-09-18T00:00:00Z",
  subject: "Subject",
  body: "Full commit body",
};
const git = {
  root: vi.fn().mockResolvedValue("/repo"),
  blameContents: vi.fn(),
  commit: vi.fn().mockResolvedValue(commit),
} satisfies Pick<Git, "root" | "blameContents" | "commit">;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host.enabled = true;
  git.blameContents.mockResolvedValue([{ sha, start: 1, count: 1 }]);
  blame = new LineBlame(git as unknown as Git);
});
afterEach(() => {
  blame.dispose();
  vi.useRealTimers();
});

it("keeps commit details on one zero-width end-of-line decoration", async () => {
  await vi.advanceTimersByTimeAsync(200);
  const decorations = host.setDecorations.mock.lastCall![1];
  expect(decorations).toHaveLength(1);
  const [decoration] = decorations;
  expect(decoration.range.start).toEqual({ line: 0, character: 8 });
  expect(decoration.range.end).toEqual(decoration.range.start);
  for (const text of [commit.author, commit.email, commit.subject, commit.body, sha])
    expect(decoration.hoverMessage.value).toContain(text);
  expect(decoration.hoverMessage.value.match(/Git Insights/g)).toHaveLength(1);
  expect(decoration.renderOptions.after.contentText).toContain(commit.subject);
});

it("keeps uncommitted attribution on the decoration", async () => {
  git.blameContents.mockResolvedValue([{ sha: "0".repeat(40), start: 1, count: 1 }]);
  await vi.advanceTimersByTimeAsync(200);
  const [decoration] = host.setDecorations.mock.lastCall![1];
  expect(decoration.hoverMessage.value).toContain("Uncommitted changes");
  expect(decoration.renderOptions.after.contentText).toBe("Uncommitted changes");
  expect(git.commit).not.toHaveBeenCalled();
});

it("clears the decoration and its hover when blame is disabled", async () => {
  await vi.advanceTimersByTimeAsync(200);
  host.enabled = false;
  blame.refresh();
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1]).toEqual([]);
});
