import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Git } from "../src/git";
import { createRepository, parseReferences } from "../src/repository";
import { layoutGraph } from "../src/graph-layout";
import { parseGraphRequest, parseGraphMessage } from "../src/graph-protocol";
const git = new Git();
let temp: string;
let root: string;
let initial: string;
let feature: string;
let main: string;
beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "git-insights-repository-"));
  root = path.join(temp, "local");
  const remote = path.join(temp, "remote.git");
  await mkdir(root);
  await mkdir(remote);
  await git.run(remote, ["init", "--bare"]);
  await git.run(root, ["init", "-b", "main"]);
  await git.run(root, ["config", "user.name", "Graph Test"]);
  await git.run(root, ["config", "user.email", "graph@example.invalid"]);
  await git.run(root, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(root, "base.txt"), "base\n");
  await git.run(root, ["add", "."]);
  await git.run(root, ["commit", "-m", "initial"]);
  initial = await git.head(root);
  await git.run(root, ["remote", "add", "origin", remote]);
  await git.run(root, ["push", "-u", "origin", "main"]);
  await git.run(root, ["switch", "-c", "remote-only"]);
  await writeFile(path.join(root, "追加 日本語.txt"), "feature\n");
  await git.run(root, ["add", "."]);
  await git.run(root, ["commit", "-m", "remote feature"]);
  feature = await git.head(root);
  await git.run(root, ["push", "origin", "remote-only"]);
  await git.run(root, ["switch", "main"]);
  await git.run(root, ["branch", "-D", "remote-only"]);
  await writeFile(path.join(root, "base.txt"), "main\n");
  await git.run(root, ["add", "."]);
  await git.run(root, ["commit", "-m", "local ahead"]);
  main = await git.head(root);
  await git.run(root, ["tag", "-a", "v1.0.0", initial, "-m", "initial release"]);
});
afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});
describe("repository-wide Git operations", () => {
  it("includes remote-only commits, annotated tags, upstream and ahead count", async () => {
    const value = await createRepository(git, root).snapshot(100);
    expect(value.commits.map((c) => c.sha)).toEqual(
      expect.arrayContaining([initial, feature, main]),
    );
    expect(value.refs.find((r) => r.id === "refs/heads/main")).toMatchObject({
      current: true,
      upstream: "refs/remotes/origin/main",
      tracking: "tracked",
      ahead: 1,
      behind: 0,
    });
    expect(value.refs.find((r) => r.id === "refs/remotes/origin/remote-only")).toMatchObject({
      sha: feature,
      kind: "remote",
    });
    expect(value.refs.find((r) => r.kind === "tag")).toMatchObject({ sha: initial });
    expect(value).toMatchObject({ branch: "main", head: main, changed: 0, truncated: false });
  });
  it("focuses a remote branch and paginates without claiming complete history", async () => {
    const repo = createRepository(git, root);
    expect(
      (await repo.snapshot(100, "refs/remotes/origin/remote-only")).commits.map((c) => c.sha),
    ).toEqual([feature, initial]);
    expect(await repo.snapshot(1)).toMatchObject({ truncated: true });
    await expect(repo.snapshot(100, "--all")).rejects.toThrow();
    await expect(repo.snapshot(5001)).rejects.toThrow();
  });
  it("compares tips and common base using immutable revisions", async () => {
    const repo = createRepository(git, root);
    expect((await repo.compare(main, feature, false)).changes.map((c) => c.path)).toEqual([
      "base.txt",
      "追加 日本語.txt",
    ]);
    const mergeBase = await repo.compare(main, feature, true);
    expect(mergeBase.before).toBe(initial);
    expect(mergeBase.changes.map((c) => c.path)).toEqual(["追加 日本語.txt"]);
    expect(await repo.inspect(initial)).toMatchObject({ before: null, after: initial });
    await expect(repo.inspect("--all")).rejects.toThrow("Invalid revision");
  });
  it("fetches a configured local remote and handles an empty repository", async () => {
    await createRepository(git, root).fetch();
    const empty = path.join(temp, "empty");
    await mkdir(empty);
    await git.run(empty, ["init", "-b", "main"]);
    expect(await createRepository(git, empty).snapshot(100)).toMatchObject({
      commits: [],
      refs: [],
      head: null,
      branch: "main",
    });
  });
});
it("represents gone upstreams and omits symbolic remote aliases", () => {
  const sha = "a".repeat(40);
  expect(
    parseReferences(`refs/heads/topic\0${sha}\0\0 \0refs/remotes/origin/topic\0[gone]\0\n`)[0]
      .tracking,
  ).toBe("gone");
  expect(
    parseReferences(`refs/remotes/origin/HEAD\0${sha}\0\0 \0\0\0refs/remotes/origin/main\n`),
  ).toEqual([]);
});
it("connects merge parents and removes lanes at roots", () => {
  const rows = layoutGraph([
    { sha: "merge", parents: ["left", "right"] },
    { sha: "left", parents: ["root"] },
    { sha: "right", parents: ["root"] },
    { sha: "root", parents: [] },
  ]);
  expect(rows[0].incoming).toHaveLength(0);
  expect(rows[0].outgoing).toHaveLength(2);
  expect(rows[2].outgoing.find((e) => e.from === rows[2].lane)?.to).toBe(0);
  expect(rows[3].outgoing).toHaveLength(0);
  expect(rows.flatMap((r) => r.outgoing).every((e) => e.to >= 0)).toBe(true);
});
it("validates graph messages and rejects malformed revision requests", () => {
  expect(parseGraphRequest({ type: "inspect", generation: 1, sha: "--all" })).toBeUndefined();
  expect(
    parseGraphRequest({
      type: "compare",
      generation: 1,
      base: "a".repeat(40),
      target: "b".repeat(40),
    }),
  ).toBeUndefined();
  expect(parseGraphRequest({ type: "diff", generation: 1, selection: 1 })).toBeUndefined();
  expect(parseGraphMessage({ type: "graph", state: { status: "ready" } })).toBeUndefined();
  expect(parseGraphRequest({ type: "fetch" })).toEqual({ type: "fetch" });
});
