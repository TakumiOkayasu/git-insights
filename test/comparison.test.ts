import { describe, expect, it, vi } from "vitest";
import { createComparisonFactory } from "../src/git-comparison";
import type { Commit, Change } from "../src/git";
const commit: Commit = {
  sha: "a".repeat(40),
  parents: ["b".repeat(40), "c".repeat(40)],
  author: "A",
  email: "a@example.invalid",
  date: "2026-09-18",
  subject: "subject",
  body: "",
};
const change: Change = { status: "M", path: "after.ts", added: "1", deleted: "1" };
describe("open selected comparison", () => {
  it.each([
    ["A", undefined, ["after.ts"]],
    ["D", undefined, ["after.ts"]],
    ["R", "before.ts", ["before.ts", "after.ts"]],
    ["M", undefined, ["after.ts", "after.ts"]],
  ] as const)("hides %s revision selection from the consumer", async (status, oldPath, paths) => {
    const read = vi.fn(
      async (_root: string, revision: string, file: string) => `${revision}:${file}`,
    );
    const present = vi.fn(async () => {});
    const factory = createComparisonFactory(read, present);
    await factory.create("/repo", commit, { ...change, status, oldPath }, () => true).open();
    expect(read.mock.calls.map((c) => c[2])).toEqual(paths);
    expect(present).toHaveBeenCalledOnce();
    const expectedBefore = status === "A" ? "" : `${commit.parents[0]}:${oldPath ?? change.path}`;
    const expectedAfter = status === "D" ? "" : `${commit.sha}:${change.path}`;
    expect(present).toHaveBeenCalledWith({
      before: expectedBefore,
      after: expectedAfter,
      file: change.path,
      revision: commit.sha,
    });
  });
  it("compares a root commit with empty content", async () => {
    const read = vi.fn(async () => "new");
    const present = vi.fn(async () => {});
    await createComparisonFactory(read, present)
      .create("/repo", { ...commit, parents: [] }, change, () => true)
      .open();
    expect(read).toHaveBeenCalledOnce();
    expect(present).toHaveBeenCalledWith({
      before: "",
      after: "new",
      file: "after.ts",
      revision: commit.sha,
    });
  });
  it("does not open stale selections, including a refresh during IO", async () => {
    let current = true;
    const present = vi.fn(async () => {});
    const read = vi.fn(async () => {
      current = false;
      return "text";
    });
    const selected = createComparisonFactory(read, present).create(
      "/repo",
      commit,
      change,
      () => current,
    );
    await selected.open();
    expect(present).not.toHaveBeenCalled();
    read.mockClear();
    await selected.open();
    expect(read).not.toHaveBeenCalled();
  });
  it("propagates read failures without opening partial diffs", async () => {
    const present = vi.fn(async () => {});
    const selected = createComparisonFactory(async () => {
      throw new Error("missing revision");
    }, present).create("/repo", commit, change, () => true);
    await expect(selected.open()).rejects.toThrow("missing revision");
    expect(present).not.toHaveBeenCalled();
  });
});
