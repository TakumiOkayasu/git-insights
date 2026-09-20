import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Git } from "../src/git";
import { LineBlame } from "../src/line-blame";

const host = vi.hoisted(() => ({
  enabled: true,
  builtinEnabled: false,
  gitEnabled: true,
  configurationChanged: undefined as
    | ((event: { affectsConfiguration: (section: string) => boolean }) => void)
    | undefined,
  setDecorations: vi.fn(),
  dispose: vi.fn(),
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  copy: vi.fn(),
  open: vi.fn(),
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
    commands: {
      registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
        host.commands.set(name, callback);
        return event();
      },
      executeCommand: vi.fn(),
    },
    Uri: { parse: (value: string) => value },
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      createTextEditorDecorationType: () => ({ dispose: host.dispose }),
      onDidChangeActiveTextEditor: event,
      onDidChangeTextEditorSelection: event,
    },
    workspace: {
      getConfiguration: (section: string) => ({
        get: (key: string) =>
          section === "gitInsights"
            ? host.enabled
            : key === "enabled"
              ? host.gitEnabled
              : host.builtinEnabled,
      }),
      onDidChangeConfiguration: (callback: typeof host.configurationChanged) => {
        host.configurationChanged = callback;
        return event();
      },
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
    env: { language: "en", clipboard: { writeText: host.copy }, openExternal: host.open },
    l10n: {
      t: (text: string, ...args: unknown[]) =>
        text.replace(/\{(\d+)\}/g, (_match, index) => String(args[index])),
    },
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
  details: vi.fn(),
  run: vi.fn(),
} satisfies Pick<Git, "root" | "blameContents" | "commit" | "details" | "run">;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  host.enabled = true;
  host.builtinEnabled = false;
  host.gitEnabled = true;
  git.blameContents.mockResolvedValue([{ sha, start: 1, count: 1 }]);
  git.details.mockResolvedValue([{ status: "M", path: "file.ts", added: "2", deleted: "1" }]);
  git.run.mockResolvedValue("git@gitlab.com:owner/repo.git");
  blame = new LineBlame(git as unknown as Git, async () => undefined);
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
  expect(decoration.hoverMessage.value).toContain("2 insertions (+)");
  expect(decoration.hoverMessage.value).toContain("1 deletions (-)");
  expect(decoration.hoverMessage.value).toContain("Open in GitLab");
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

it("defers to built-in blame without loading duplicate commit details", async () => {
  host.builtinEnabled = true;
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1]).toEqual([]);
  expect(git.blameContents).not.toHaveBeenCalled();
});

it("clears and restores its annotation when built-in blame is toggled", async () => {
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1]).toHaveLength(1);
  host.builtinEnabled = true;
  host.configurationChanged!({
    affectsConfiguration: (section) => section === "git.blame.editorDecoration.enabled",
  });
  expect(host.setDecorations.mock.lastCall![1]).toEqual([]);
  host.builtinEnabled = false;
  host.configurationChanged!({
    affectsConfiguration: (section) => section === "git.blame.editorDecoration.enabled",
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1]).toHaveLength(1);
});

it("does not defer to a disabled built-in Git extension", async () => {
  host.builtinEnabled = true;
  host.gitEnabled = false;
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1]).toHaveLength(1);
});

it("does not restore pending details after built-in blame takes over", async () => {
  let resolve!: (changes: []) => void;
  git.details.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  await vi.advanceTimersByTimeAsync(200);
  host.builtinEnabled = true;
  host.configurationChanged!({
    affectsConfiguration: (section) => section === "git.blame.editorDecoration.enabled",
  });
  resolve([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(host.setDecorations.mock.lastCall![1]).toEqual([]);
});

it("copies the full SHA and opens the selected commit, rejecting stale links", async () => {
  await vi.advanceTimersByTimeAsync(200);
  const markdown = host.setDecorations.mock.lastCall![1][0].hoverMessage.value;
  const query = /command:gitInsights\.blame\.copySha\?([^)]*)/.exec(markdown)![1];
  const [generation] = JSON.parse(decodeURIComponent(query));
  await host.commands.get("gitInsights.blame.copySha")!(generation);
  expect(host.copy).toHaveBeenCalledWith(sha);
  await host.commands.get("gitInsights.blame.openRemote")!(generation);
  expect(host.open).toHaveBeenCalledWith(`https://gitlab.com/owner/repo/-/commit/${sha}`);
  blame.refresh();
  await vi.advanceTimersByTimeAsync(200);
  await host.commands.get("gitInsights.blame.copySha")!(generation);
  await host.commands.get("gitInsights.blame.openRemote")!(generation);
  expect(host.copy).toHaveBeenCalledTimes(1);
  expect(host.open).toHaveBeenCalledTimes(1);
});

it("retains attribution and reports a statistics failure without inventing zero counts", async () => {
  git.details.mockRejectedValueOnce(new Error("Git failed"));
  await vi.advanceTimersByTimeAsync(200);
  const value = host.setDecorations.mock.lastCall![1][0].hoverMessage.value;
  expect(value).toContain(commit.author);
  expect(value).toContain("Change statistics unavailable.");
  expect(value).not.toContain("0 files changed");
  blame.refresh();
  await vi.advanceTimersByTimeAsync(200);
  expect(git.details).toHaveBeenCalledTimes(2);
});

it("omits unsupported or missing remotes while preserving commit details", async () => {
  git.run.mockRejectedValueOnce(new Error("No origin"));
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1][0].hoverMessage.value).not.toContain(
    "link-external",
  );
  git.run.mockResolvedValue("https://user:secret@gitlab.com/owner/repo.git");
  blame.refresh();
  await vi.advanceTimersByTimeAsync(200);
  const value = host.setDecorations.mock.lastCall![1][0].hoverMessage.value;
  expect(value).toContain(commit.author);
  expect(value).not.toContain("link-external");
  expect(value).not.toContain("secret");
});

it("does not redisplay stale details after the annotation is disabled", async () => {
  let resolve!: (changes: []) => void;
  git.details.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await vi.advanceTimersByTimeAsync(200);
  expect(host.setDecorations.mock.lastCall![1][0].hoverMessage.value).toContain("Loading…");
  host.enabled = false;
  blame.refresh();
  resolve([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(host.setDecorations.mock.lastCall![1]).toEqual([]);
});

it("reuses immutable statistics for the same commit", async () => {
  await vi.advanceTimersByTimeAsync(200);
  blame.refresh();
  await vi.advanceTimersByTimeAsync(200);
  expect(git.details).toHaveBeenCalledTimes(1);
});
