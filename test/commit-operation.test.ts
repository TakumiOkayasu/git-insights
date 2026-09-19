import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Git } from "../src/git";
import { CommitOperations } from "../src/commit-operation";

const git = new Git();
let root: string;
let first: string;
let second: string;
let operations: CommitOperations;
const run = (...args: string[]) => git.run(root, args);
async function commit(file: string, content: string, message: string) {
  await writeFile(path.join(root, file), content);
  await run("add", file);
  await run("commit", "-m", message);
  return git.head(root);
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "git-insights-operation-"));
  await run("init", "-b", "main");
  await run("config", "user.name", "Test Author");
  await run("config", "user.email", "test@example.invalid");
  await run("config", "commit.gpgsign", "false");
  await run("config", "core.autocrlf", "false");
  first = await commit("a.txt", "initial\n", "Initial");
  second = await commit("b.txt", "second\n", "Second");
  operations = new CommitOperations(git);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("serializes execution across review editors for the same worktree", async () => {
  const a = await operations.prepare(root, "reword", second);
  const b = await operations.prepare(root, "reword", second);
  const runGit = git.run.bind(git);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(git, "run").mockImplementation(async (...args) => {
    if (args[1].includes("--amend")) await gate;
    return runGit(...args);
  });
  const firstExecution = a.execute("First editor");
  try {
    await expect(b.execute("Second editor")).rejects.toThrow("Another commit operation");
  } finally {
    release();
    await firstExecution;
  }
  expect((await run("show", "-s", "--format=%s", "HEAD")).trim()).toBe("First editor");
});
it("prepares without mutation and applies only the selected commit once", async () => {
  await run("switch", "-c", "source");
  const source = await commit("c.txt", "picked\n", "Cherry source");
  await run("switch", "main");
  const operation = await operations.prepare(root, "cherry-pick", source);
  expect(await git.head(root)).toBe(second);
  expect(operation.preview).toMatchObject({
    sha: source,
    head: second,
    branch: "refs/heads/main",
    kind: "cherry-pick",
  });
  await operation.execute("");
  expect(await readFile(path.join(root, "c.txt"), "utf8")).toBe("picked\n");
  expect((await run("show", "-s", "--format=%P", "HEAD")).trim()).toBe(second);
  await expect(operation.execute("")).rejects.toThrow("Reopen");
});
it("rewords HEAD without adding files or changing the tree", async () => {
  const tree = (await run("rev-parse", "HEAD^{tree}")).trim();
  const operation = await operations.prepare(root, "reword", second);
  expect(operation.preview.rewritten).toBe(1);
  await operation.execute("新しい件名\n\n本文 ' $() `literal`\n# preserved\n");
  expect((await run("rev-parse", "HEAD^{tree}")).trim()).toBe(tree);
  expect((await run("show", "-s", "--format=%P", "HEAD")).trim()).toBe(first);
  expect(await run("show", "-s", "--format=%B", "HEAD")).toContain("# preserved");
});
it.each([true, false])(
  "rewords an ancestor (root=%s) and preserves descendants and tree",
  async (isRoot) => {
    const third = await commit("c.txt", "third\n", "Third");
    const tree = (await run("rev-parse", "HEAD^{tree}")).trim();
    // Existing user rebase preferences must not squash commits or move other branches.
    await run("branch", "keep", third);
    await run("config", "rebase.autoSquash", "true");
    await run("config", "rebase.updateRefs", "true");
    const operation = await operations.prepare(root, "reword", isRoot ? first : second);
    expect(operation.preview.rewritten).toBe(isRoot ? 3 : 2);
    await operation.execute("改名\n\nExact body\n# preserved\n");
    expect((await run("rev-parse", "HEAD^{tree}")).trim()).toBe(tree);
    expect((await run("rev-parse", "keep")).trim()).toBe(third);
    expect((await run("rev-list", "--count", "HEAD")).trim()).toBe("3");
    const subjects = (await run("log", "--format=%s", "--reverse")).trim().split("\n");
    expect(subjects).toEqual(isRoot ? ["改名", "Second", "Third"] : ["Initial", "改名", "Third"]);
    expect(await run("show", "-s", "--format=%B", isRoot ? "HEAD~2" : "HEAD~1")).toContain(
      "# preserved",
    );
  },
);
it("refuses stale HEAD and a branch switch even at the same commit", async () => {
  const stale = await operations.prepare(root, "reword", second);
  await commit("c.txt", "third", "Third");
  const head = await git.head(root);
  await expect(stale.execute("Changed")).rejects.toThrow("HEAD or branch changed");
  expect(await git.head(root)).toBe(head);
  const switched = await operations.prepare(root, "reword", head);
  await run("switch", "-c", "other");
  await expect(switched.execute("Changed")).rejects.toThrow("HEAD or branch changed");
});
it.each(["unstaged", "staged", "untracked"])(
  "refuses %s changes created after preview",
  async (kind) => {
    const operation = await operations.prepare(root, "reword", second);
    await writeFile(path.join(root, kind === "untracked" ? "new.txt" : "a.txt"), "dirty");
    if (kind === "staged") await run("add", "a.txt");
    await expect(operation.execute("Changed")).rejects.toThrow("Commit or stash");
    expect(await git.head(root)).toBe(second);
  },
);
it.each(["", " \n", "bad\0message"])(
  "rejects invalid messages without changing HEAD",
  async (message) => {
    const operation = await operations.prepare(root, "reword", second);
    await expect(operation.execute(message)).rejects.toThrow("non-empty");
    expect(await git.head(root)).toBe(second);
  },
);
it("leaves cherry-pick conflicts available for native abort", async () => {
  await run("switch", "-c", "source", first);
  const source = await commit("a.txt", "source\n", "Source");
  await run("switch", "main");
  const head = await commit("a.txt", "destination\n", "Destination");
  const operation = await operations.prepare(root, "cherry-pick", source);
  await expect(operation.execute("")).rejects.toThrow();
  expect(await git.head(root)).toBe(head);
  expect((await run("rev-parse", "CHERRY_PICK_HEAD")).trim()).toBe(source);
  await expect(operations.prepare(root, "reword", head)).rejects.toThrow("Finish or abort");
  await run("cherry-pick", "--abort");
  expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("destination\n");
});
it("rejects unrelated commits, detached HEAD and histories containing merges", async () => {
  await run("switch", "-c", "side", first);
  const side = await commit("side.txt", "side", "Side");
  await run("switch", "main");
  await expect(operations.prepare(root, "reword", side)).rejects.toThrow();
  await run("merge", "--no-ff", "side", "-m", "Merge");
  const merge = await git.head(root);
  await expect(operations.prepare(root, "reword", second)).rejects.toThrow("across merges");
  await expect(operations.prepare(root, "cherry-pick", merge)).rejects.toThrow("Merge commits");
  await run("switch", "--detach", second);
  await expect(operations.prepare(root, "reword", second)).rejects.toThrow();
});
it("recognizes Git operation markers in a linked worktree", async () => {
  const linked = `${root}-linked`;
  try {
    await run("worktree", "add", "-b", "linked", linked);
    const gitdir = (await git.run(linked, ["rev-parse", "--absolute-git-dir"])).trim();
    await writeFile(path.join(gitdir, "CHERRY_PICK_HEAD"), first);
    await expect(operations.prepare(linked, "reword", second)).rejects.toThrow("Finish or abort");
  } finally {
    await run("worktree", "remove", "--force", linked);
  }
});
