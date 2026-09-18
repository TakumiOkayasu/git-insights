import { Git, parseLog, parseChanges, isSha, type Commit, type Change } from "./git";

export interface Reference {
  readonly id: string;
  readonly name: string;
  readonly kind: "local" | "remote" | "tag";
  readonly sha: string;
  readonly current: boolean;
  readonly upstream: string;
  readonly tracking: "none" | "tracked" | "gone";
  readonly ahead: number;
  readonly behind: number;
}
export interface RepositorySnapshot {
  readonly commits: readonly Commit[];
  readonly refs: readonly Reference[];
  readonly head: string | null;
  readonly branch: string;
  readonly changed: number;
  readonly remotes: readonly string[];
  readonly truncated: boolean;
}
export interface RevisionSelection {
  readonly before: string | null;
  readonly after: string;
  readonly title: string;
  readonly changes: readonly Change[];
}
// The UI asks for repository operations. Git commands and wire formats stay here.
export interface Repository {
  snapshot(limit: number, focus?: string): Promise<RepositorySnapshot>;
  inspect(sha: string): Promise<RevisionSelection>;
  compare(base: string, target: string, commonBase: boolean): Promise<RevisionSelection>;
  fetch(): Promise<void>;
}
export function parseReferences(text: string): Reference[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [id, object, peeled, current, upstream, track, symbolic] = line.split("\0");
      if (symbolic) return [];
      const kind = id.startsWith("refs/heads/")
        ? "local"
        : id.startsWith("refs/remotes/")
          ? "remote"
          : "tag";
      const sha = peeled || object;
      if (!isSha(sha)) throw new Error("Invalid reference");
      return [
        {
          id,
          name: id.replace(/^refs\/(heads|remotes|tags)\//, ""),
          kind,
          sha,
          current: current === "*",
          upstream,
          tracking: !upstream ? "none" : track === "[gone]" ? "gone" : "tracked",
          ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
          behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
        },
      ];
    });
}
function revision(value: string) {
  if (!isSha(value)) throw new Error("Invalid revision");
  return value;
}
const logFormat = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00";
export function createRepository(git: Git, root: string): Repository {
  const differences = async (before: string, after: string) => {
    const args = ["diff", "--no-ext-diff", "--no-textconv", "-M"];
    const [names, stats] = await Promise.all([
      git.run(root, [...args, "--name-status", "-z", before, after, "--"]),
      git.run(root, [...args, "--numstat", "-z", before, after, "--"]),
    ]);
    return parseChanges(names, stats);
  };
  return {
    async snapshot(limit, focus) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000)
        throw new Error("Invalid limit");
      const [rawRefs, rawHead, status, remotes, branch] = await Promise.all([
        git.run(root, [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(HEAD)%00%(upstream)%00%(upstream:track)%00%(symref)",
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ]),
        git.run(root, ["rev-parse", "--verify", "HEAD"]).catch(() => ""),
        git.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
        git.run(root, ["remote"]),
        git.run(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
      ]);
      const head = isSha(rawHead.trim()) ? rawHead.trim() : null;
      const refs = parseReferences(rawRefs);
      const selected = focus ? refs.find((r) => r.id === focus) : undefined;
      if (focus && !selected) throw new Error("The selected branch no longer exists.");
      const starts = selected ? [selected.sha] : ["--all", ...(head ? [head] : [])];
      const commits =
        refs.length || head
          ? parseLog(
              await git.run(root, [
                "log",
                "--topo-order",
                `--max-count=${limit + 1}`,
                `--format=${logFormat}`,
                "--no-patch",
                ...starts,
                "--",
              ]),
            )
          : [];
      const tokens = status.split("\0");
      let changed = 0;
      for (let i = 0; i < tokens.length && tokens[i]; i++) {
        changed++;
        if (/^[RC]|^.[RC]/.test(tokens[i])) i++;
      }
      return {
        commits: commits.slice(0, limit),
        refs,
        head,
        branch: branch.trim(),
        changed,
        remotes: remotes.trim().split("\n").filter(Boolean),
        truncated: commits.length > limit,
      };
    },
    async inspect(sha) {
      const [commit] = parseLog(
        await git.run(root, ["log", "-1", `--format=${logFormat}`, revision(sha), "--"]),
      );
      if (!commit) throw new Error("Commit not found");
      return {
        before: commit.parents[0] ?? null,
        after: commit.sha,
        title: commit.subject,
        changes: await git.details(root, commit),
      };
    },
    async compare(base, target, commonBase) {
      let before = revision(base);
      const after = revision(target);
      if (commonBase)
        before = revision((await git.run(root, ["merge-base", before, after])).trim());
      return {
        before,
        after,
        title: `${before.slice(0, 8)} → ${after.slice(0, 8)}`,
        changes: await differences(before, after),
      };
    },
    async fetch() {
      await git.run(root, ["fetch", "--all"]);
    },
  };
}
