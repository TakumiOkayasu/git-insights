import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rename, rm, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Git, parseLog, parseChanges, remoteCommitUrl } from "../src/git";
import { parseTodo, serializeTodo } from "../src/rebase";

const git = new Git();
let root: string;
let initial: string;
let renamed: string;
const firstName = "日本語 file.txt";
const secondName = "renamed 日本語.txt";
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "git-insights-test-"));
  await git.run(root, ["init"]);
  await git.run(root, ["config", "user.name", "テスト Author"]);
  await git.run(root, ["config", "user.email", "test@example.invalid"]);
  await git.run(root, ["config", "commit.gpgsign", "false"]);
  await git.run(root, ["config", "core.autocrlf", "false"]);
  await writeFile(path.join(root, firstName), "one\ntwo\nthree\n");
  await git.run(root, ["add", "."]);
  await git.run(root, ["commit", "-m", "Initial 日本語", "-m", "Body with\nmultiple lines"]);
  initial = await git.head(root);
  await rename(path.join(root, firstName), path.join(root, secondName));
  await git.run(root, ["add", "-A"]);
  await git.run(root, ["commit", "-m", "Rename file"]);
  renamed = await git.head(root);
  await writeFile(path.join(root, secondName), "one\nchanged\nthree\n");
  await git.run(root, ["add", "."]);
  await git.run(root, ["commit", "-m", "Change line"]);
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("real Git repositories", () => {
  it("follows renames and retains Unicode author, subject and multiline body", async () => {
    const history = await git.history(root, path.join(root, secondName), 100);
    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({
      sha: initial,
      author: "テスト Author",
      subject: "Initial 日本語",
      body: "Body with\nmultiple lines\n",
    });
  });
  it("shows root commit changes and content", async () => {
    const commit = (await git.history(root, path.join(root, secondName), 100))[2];
    expect(await git.details(root, commit)).toEqual([
      { status: "A", path: firstName, oldPath: undefined, added: "3", deleted: "0" },
    ]);
    expect(await git.content(root, initial, firstName)).toBe("one\ntwo\nthree\n");
  });
  it("pairs old and new paths and stats for a rename", async () => {
    const commit = (await git.history(root, path.join(root, secondName), 100)).find(
      (c) => c.sha === renamed,
    )!;
    expect(await git.details(root, commit)).toEqual([
      { status: "R", path: secondName, oldPath: firstName, added: "0", deleted: "0" },
    ]);
  });
  it("returns selected line history without patch data", async () => {
    const history = await git.history(root, path.join(root, secondName), 100, [2, 2]);
    expect(history[0].subject).toBe("Change line");
    expect(history.at(-1)?.sha).toBe(initial);
  });
  it("parses incremental blame ranges and repeated author metadata", async () => {
    const blame = await git.blame(root, path.join(root, secondName));
    expect(blame.reduce((sum, b) => sum + b.count, 0)).toBe(3);
    expect(blame.every((b) => b.author === "テスト Author" && b.time > 0)).toBe(true);
  });
  it("rejects files outside the repository", () => {
    expect(() => git.relative(root, path.join(root, "..", "other.txt"))).toThrow();
  });
  it("resolves directory aliases before checking repository containment", async () => {
    const alias = path.join(root, "directory-alias");
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    try {
      expect(git.relative(root, path.join(alias, secondName))).toBe(secondName);
      expect(await git.history(root, path.join(alias, secondName), 10)).toHaveLength(3);
    } finally {
      await unlink(alias);
    }
  });
  it("handles empty repositories and aborts Git", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(git.run(root, ["status"], controller.signal)).rejects.toThrow();
  });
});
describe("parsers and remote links", () => {
  it("preserves tabs and newlines in NUL-delimited paths", () => {
    expect(parseChanges("M\0a\tb\nc\0", "1\t2\ta\tb\nc\0")[0]).toMatchObject({
      path: "a\tb\nc",
      added: "1",
      deleted: "2",
    });
  });
  it("accepts binary counts", () => {
    expect(parseChanges("A\0image.png\0", "-\t-\timage.png\0")[0].added).toBe("-");
  });
  it("rejects invalid history", () => {
    expect(() => parseLog("oops\0\0a\0b\0c\0d\0e\0")).toThrow();
  });
  it("restricts remote navigation to recognized HTTPS providers", () => {
    expect(remoteCommitUrl("git@github.com:owner/repo.git", "a".repeat(40))).toBe(
      `https://github.com/owner/repo/commit/${"a".repeat(40)}`,
    );
    expect(remoteCommitUrl("javascript:alert(1)", "a".repeat(40))).toBeUndefined();
    expect(remoteCommitUrl("https://user:secret@github.com/o/r", "a".repeat(40))).toBeUndefined();
  });
});
describe("rebase plans", () => {
  const source = "# keep comment\r\np abcdef1 first\r\npick abcdef2 second\r\n\r\n";
  it("reorders rows, normalizes aliases and preserves comments and CRLF", () => {
    const todo = parseTodo(source);
    expect(serializeTodo(todo, [...todo.rows].reverse())).toBe(
      "# keep comment\r\npick abcdef2 second\r\npick abcdef1 first\r\n\r\n",
    );
  });
  it("rejects squash and fixup without an earlier retained commit", () => {
    const todo = parseTodo(source);
    expect(() =>
      serializeTodo(
        todo,
        todo.rows.map((r) => ({ ...r, action: "squash" })),
      ),
    ).toThrow("preceding");
    expect(() =>
      serializeTodo(todo, [
        { ...todo.rows[0], action: "drop" },
        { ...todo.rows[1], action: "fixup" },
      ]),
    ).toThrow("preceding");
  });
  it("rejects omitted, duplicated and injected rows", () => {
    const todo = parseTodo(source);
    expect(() => serializeTodo(todo, todo.rows.slice(1))).toThrow();
    expect(() => serializeTodo(todo, [todo.rows[0], todo.rows[0]])).toThrow();
    expect(() =>
      serializeTodo(todo, [{ ...todo.rows[0], message: "\nexec bad" }, todo.rows[1]]),
    ).toThrow();
  });
  it.each([
    "exec echo hello",
    "label here",
    "reset here",
    "merge -C abcdef1 here",
    "fixup -C abcdef1 msg",
    "update-ref refs/heads/main",
    "break",
  ])("preserves advanced instruction %s and requires text editing", (line) => {
    const todo = parseTodo(source + line);
    expect(todo.supported).toBe(false);
    expect(() => serializeTodo(todo, todo.rows)).toThrow("text editor");
  });
});
