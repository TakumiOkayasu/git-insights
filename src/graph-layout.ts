import type { Commit } from "./git";
export interface GraphRow {
  readonly lane: number;
  readonly color: number;
  readonly incoming: readonly { from: number; to: number; color: number }[];
  readonly outgoing: readonly { from: number; to: number; color: number }[];
}
// Topological order is required. Every active lane names a future parent commit.
export function layoutGraph(commits: readonly Pick<Commit, "sha" | "parents">[]): GraphRow[] {
  let lanes: { sha: string; color: number }[] = [];
  let color = 0;
  const parents = new Set(commits.flatMap((commit) => commit.parents));
  return commits.map((commit) => {
    let lane = lanes.findIndex((x) => x.sha === commit.sha);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ sha: commit.sha, color: color++ });
    }
    const nodeColor = lanes[lane].color;
    const incoming = lanes.map((x, i) => ({ from: i, to: i, color: x.color }));
    const next = lanes.filter((_, i) => i !== lane);
    commit.parents.forEach((sha, i) => {
      if (!next.some((x) => x.sha === sha))
        next.splice(Math.min(lane + i, next.length), 0, {
          sha,
          color: i === 0 ? nodeColor : color++,
        });
    });
    const outgoing = lanes.flatMap((x, i) =>
      i === lane ? [] : [{ from: i, to: next.findIndex((n) => n.sha === x.sha), color: x.color }],
    );
    for (const sha of commit.parents) {
      const to = next.findIndex((x) => x.sha === sha);
      outgoing.push({ from: lane, to, color: next[to].color });
    }
    // A newly encountered tip has no edge above it.
    const result = {
      lane,
      color: nodeColor,
      incoming: incoming.filter((_, i) => i !== lane || parents.has(commit.sha)),
      outgoing,
    };
    lanes = next;
    return result;
  });
}
