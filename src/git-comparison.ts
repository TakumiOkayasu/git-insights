import type { Comparison } from "./comparison";
import type { Commit, Change } from "./git";

/** Presentation/IO boundary: text and file names are exposed only to the editor adapter. */
export interface ComparisonPresentation {
  readonly before: string;
  readonly after: string;
  readonly file: string;
  readonly revision: string;
}
export interface ComparisonFactory {
  create(root: string, commit: Commit, change: Change, isCurrent: () => boolean): Comparison;
}
export function createComparisonFactory(
  read: (root: string, revision: string, file: string) => Promise<string>,
  present: (value: ComparisonPresentation) => Promise<void>,
): ComparisonFactory {
  return {
    create(root, commit, change, isCurrent) {
      // Capture one immutable selection; consumers never interpret its status or parent.
      const parent = commit.parents[0];
      const revision = commit.sha;
      const file = change.path;
      const beforeFile = change.oldPath ?? file;
      const added = change.status === "A";
      const deleted = change.status === "D";
      return {
        async open() {
          if (!isCurrent()) return;
          const [before, after] = await Promise.all([
            added || !parent ? "" : read(root, parent, beforeFile),
            deleted ? "" : read(root, revision, file),
          ]);
          if (isCurrent()) await present({ before, after, file, revision });
        },
      } satisfies Comparison;
    },
  };
}
