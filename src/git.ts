import { spawn } from "node:child_process";
import path from "node:path";

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  avatar?: string;
}
export interface Change {
  status: string;
  path: string;
  oldPath?: string;
  added: string;
  deleted: string;
}
export interface Blame {
  sha: string;
  author: string;
  time: number;
  start: number;
  count: number;
}
export const isSha = (s: unknown): s is string =>
  typeof s === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
const format = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00";

export function parseLog(text: string): Commit[] {
  const fields = text.split("\0");
  const result: Commit[] = [];
  for (let i = 0; i + 6 < fields.length; i += 7) {
    const sha = fields[i].trim();
    if (!isSha(sha)) throw new Error("Invalid Git log record");
    result.push({
      sha,
      parents: fields[i + 1].split(" ").filter(Boolean),
      author: fields[i + 2],
      email: fields[i + 3],
      date: fields[i + 4],
      subject: fields[i + 5],
      body: fields[i + 6],
    });
  }
  return result;
}

export function parseChanges(names: string, stats: string): Change[] {
  const tokens = names.split("\0");
  const result: Change[] = [];
  for (let i = 0; i < tokens.length && tokens[i]; ) {
    const status = tokens[i++];
    const first = tokens[i++];
    const rename = /^[RC]/.test(status);
    result.push({
      status: status[0],
      path: rename ? tokens[i++] : first,
      oldPath: rename ? first : undefined,
      added: "-",
      deleted: "-",
    });
  }
  const nums = stats.split("\0");
  const counts = new Map<string, [string, string]>();
  for (let i = 0; i < nums.length && nums[i]; ) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(nums[i++]);
    if (!m) throw new Error("Invalid Git numstat record");
    let name = m[3];
    if (!name) {
      i++;
      name = nums[i++];
    }
    counts.set(name, [m[1], m[2]]);
  }
  for (const change of result) {
    const n = counts.get(change.path);
    if (n) [change.added, change.deleted] = n;
  }
  return result;
}

export function parseBlame(text: string): Blame[] {
  const result: Blame[] = [];
  const authors = new Map<string, { author: string; time: number }>();
  let item: Blame | undefined;
  for (const line of text.split("\n")) {
    const header = /^([a-f0-9]{40,64}) \d+ (\d+) (\d+)$/.exec(line);
    if (header) {
      const cached = authors.get(header[1]);
      item = {
        sha: header[1],
        start: Number(header[2]),
        count: Number(header[3]),
        author: cached?.author ?? "",
        time: cached?.time ?? 0,
      };
    } else if (item && line.startsWith("author ")) item.author = line.slice(7);
    else if (item && line.startsWith("author-time ")) item.time = Number(line.slice(12));
    else if (item && line.startsWith("filename ")) {
      authors.set(item.sha, { author: item.author, time: item.time });
      result.push(item);
      item = undefined;
    }
  }
  return result;
}

export class Git {
  constructor(public executable = "git") {}
  run(root: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        ["--no-pager", "--literal-pathspecs", "-c", "core.quotepath=false", ...args],
        {
          cwd: root,
          shell: false,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
          signal,
        },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new Error("Git timed out");
        child.kill();
      }, 30_000);
      child.stdout.on("data", (b: Buffer) => {
        bytes += b.length;
        if (bytes > 24 * 1024 * 1024) {
          failure = new Error("Git output exceeds 24 MiB");
          child.kill();
        } else stdout.push(b);
      });
      child.stderr.on("data", (b: Buffer) => {
        if (stderr.length < 100) stderr.push(b);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure || code !== 0)
          reject(
            failure ??
              new Error(Buffer.concat(stderr).toString("utf8").trim() || `Git exited ${code}`),
          );
        else resolve(Buffer.concat(stdout).toString("utf8"));
      });
    });
  }
  async root(file: string): Promise<string> {
    return (await this.run(path.dirname(file), ["rev-parse", "--show-toplevel"])).trim();
  }
  relative(root: string, file: string): string {
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative))
      throw new Error("File is outside repository");
    return relative;
  }
  async head(root: string): Promise<string> {
    return (await this.run(root, ["rev-parse", "--verify", "HEAD"])).trim();
  }
  async history(
    root: string,
    file: string,
    limit: number,
    range?: [number, number],
    signal?: AbortSignal,
  ): Promise<Commit[]> {
    const rel = this.relative(root, file);
    const args = ["log", `--max-count=${limit}`, `--format=${format}`, "--no-patch"];
    if (range) args.push("-L", `${range[0]},${range[1]}:./${rel}`, "HEAD");
    else args.push("--follow", "HEAD", "--", rel);
    return parseLog(await this.run(root, args, signal));
  }
  async details(root: string, commit: Commit): Promise<Change[]> {
    const base = ["diff-tree", "--no-commit-id", "-r", "-M", "--no-ext-diff", "--no-textconv"];
    const revs = commit.parents.length ? [commit.parents[0], commit.sha] : ["--root", commit.sha];
    const [names, stats] = await Promise.all([
      this.run(root, [...base, "--name-status", "-z", ...revs]),
      this.run(root, [...base, "--numstat", "-z", ...revs]),
    ]);
    return parseChanges(names, stats);
  }
  async content(root: string, sha: string, file: string): Promise<string> {
    if (!isSha(sha)) throw new Error("Invalid revision");
    return this.run(root, ["show", `${sha}:${file}`]);
  }
  async blame(root: string, file: string): Promise<Blame[]> {
    return parseBlame(
      await this.run(root, ["blame", "--incremental", "HEAD", "--", this.relative(root, file)]),
    );
  }
}

export function remoteCommitUrl(remote: string, sha: string): string | undefined {
  if (!isSha(sha)) return;
  const normalized = remote
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password) return;
    if (url.hostname === "github.com") return `${url.origin}${url.pathname}/commit/${sha}`;
    if (url.hostname === "gitlab.com") return `${url.origin}${url.pathname}/-/commit/${sha}`;
    if (url.hostname === "bitbucket.org") return `${url.origin}${url.pathname}/commits/${sha}`;
  } catch {
    /* Unsupported remote. */
  }
}
