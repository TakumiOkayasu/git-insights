import { mkdtemp, writeFile, rm, stat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Git, isSha } from "./git";

import { isOperationKind, type OperationKind } from "./commit-operation-kind";
export type { OperationKind } from "./commit-operation-kind";
export interface OperationPreview {
  readonly kind: OperationKind;
  readonly root: string;
  readonly sha: string;
  readonly head: string;
  readonly branch: string;
  readonly message: string;
  readonly rewritten: number;
}
export interface CommitOperation {
  readonly preview: OperationPreview;
  execute(message: string): Promise<void>;
}
const markers = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
  "BISECT_LOG",
];
async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
// Git invokes editors through a shell, even though Git.run itself uses argv.
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const editorScript = `const fs = require('node:fs');
const [dataFile, mode, file] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (mode === 'sequence') {
  let matches = 0;
  const todo = fs.readFileSync(file, 'utf8').replace(/^pick ([a-f0-9]+)( .*)?$/gm, (line, sha) => {
    if (!data.sha.startsWith(sha)) return line;
    matches++;
    return line.replace(/^pick /, 'reword ');
  });
  if (matches !== 1) throw new Error('Selected commit missing from rebase plan');
  fs.writeFileSync(file, todo);
} else {
  fs.writeFileSync(file, data.message);
}
`;

export class CommitOperations {
  private readonly running = new Set<string>();
  constructor(private readonly git: Git) {}
  private async state(root: string, ownedDirectory?: string) {
    const directory = await realpath(
      (await this.git.run(root, ["rev-parse", "--absolute-git-dir"])).trim(),
    );
    if (this.running.has(directory) && directory !== ownedDirectory)
      throw new Error("Another commit operation is running.");
    for (const marker of markers) {
      if (await exists(path.join(directory, marker)))
        throw new Error("Finish or abort the current Git operation first.");
    }
    if (await this.git.run(root, ["status", "--porcelain=v1", "--untracked-files=normal"]))
      throw new Error("Commit or stash working changes before starting.");
    const head = await this.git.head(root);
    const branch = (await this.git.run(root, ["symbolic-ref", "--quiet", "HEAD"])).trim();
    return { directory, head, branch };
  }
  async prepare(root: string, kind: OperationKind, sha: string): Promise<CommitOperation> {
    if (!isOperationKind(kind) || !isSha(sha)) throw new Error("Invalid commit operation.");
    const initial = await this.state(root);
    const commit = await this.git.commit(root, sha);
    if (commit.parents.length > 1)
      throw new Error("Merge commits require the existing Git workflow.");
    let rewritten = 0;
    if (kind === "reword") {
      await this.git.run(root, ["merge-base", "--is-ancestor", sha, initial.head]);
      const descendants = `${sha}..${initial.head}`;
      if ((await this.git.run(root, ["rev-list", "--merges", descendants])).trim())
        throw new Error("Reword across merges requires the existing Git workflow.");
      rewritten =
        Number((await this.git.run(root, ["rev-list", "--count", descendants])).trim()) + 1;
    }
    const message = await this.git.run(root, ["show", "-s", "--format=%B", sha, "--"]);
    const preview: OperationPreview = Object.freeze({
      kind,
      root,
      sha,
      head: initial.head,
      branch: initial.branch,
      message,
      rewritten,
    });
    let attempted = false;
    return {
      preview,
      execute: async (newMessage) => {
        if (attempted) throw new Error("Reopen the operation from the graph before retrying.");
        attempted = true;
        if (
          kind === "reword" &&
          (!newMessage.trim() || newMessage.includes("\0") || newMessage.length > 100_000)
        )
          throw new Error("Enter a non-empty commit message (up to 100000 characters).");
        if (this.running.has(initial.directory))
          throw new Error("Another commit operation is running.");
        this.running.add(initial.directory);
        try {
          const current = await this.state(root, initial.directory);
          if (
            current.directory !== initial.directory ||
            current.head !== initial.head ||
            current.branch !== initial.branch
          )
            throw new Error("HEAD or branch changed. Reopen the operation from the graph.");
          if (kind === "cherry-pick") {
            await this.git.run(root, ["cherry-pick", "--no-edit", sha]);
          } else if (sha === initial.head) {
            await this.git.run(
              root,
              ["commit", "--amend", "--only", "--cleanup=verbatim", "-F", "-"],
              undefined,
              newMessage,
            );
          } else {
            await this.reword(root, sha, commit.parents[0], newMessage);
          }
        } finally {
          this.running.delete(initial.directory);
        }
      },
    };
  }
  private async reword(root: string, sha: string, parent: string | undefined, message: string) {
    const temp = await mkdtemp(path.join(os.tmpdir(), "git-insights-reword-"));
    try {
      const script = path.join(temp, "editor.cjs");
      const data = path.join(temp, "message.json");
      await writeFile(script, editorScript, { mode: 0o600 });
      await writeFile(data, JSON.stringify({ sha, message }), { mode: 0o600 });
      const command = [process.execPath, script, data]
        .map((p) => shellQuote(process.platform === "win32" ? p.replaceAll("\\", "/") : p))
        .join(" ");
      await this.git.run(
        root,
        [
          "-c",
          "commit.cleanup=verbatim",
          "-c",
          "rebase.instructionFormat=%s",
          "-c",
          "rebase.abbreviateCommands=false",
          "rebase",
          "--interactive",
          "--no-autosquash",
          "--no-autostash",
          "--no-update-refs",
          "--no-rebase-merges",
          "--keep-empty",
          "--empty=keep",
          ...(parent ? [parent] : ["--root"]),
        ],
        undefined,
        undefined,
        {
          GIT_SEQUENCE_EDITOR: `${command} sequence`,
          GIT_EDITOR: `${command} message`,
          ELECTRON_RUN_AS_NODE: "1",
        },
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}
