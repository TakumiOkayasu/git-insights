import type { HistoryRequest, HistoryResult, HistoryContext, HostMessage } from "../src/protocol";
import type { LabelKey } from "../src/labels";
// These compile-time assertions fail the typecheck if the contracts become permissive.
export function contractAssertions(
  send: (request: HistoryRequest) => void,
  show: (state: HistoryResult) => void,
  context: (value: HistoryContext) => void,
  label: (key: LabelKey) => void,
  message: HostMessage,
) {
  // @ts-expect-error Diff requires a path.
  send({ type: "diff", generation: 1, sha: "a" });
  // @ts-expect-error Line scope requires a range when a file exists.
  context({ mode: "line", file: "a.ts" });
  // @ts-expect-error Success requires commits and a truncation flag.
  show({ status: "ready" });
  // @ts-expect-error Failure cannot carry successful history data.
  show({ status: "error", notice: "failed", commits: [] });
  // @ts-expect-error Translation keys form a closed set.
  label("File Histroy");
  // @ts-expect-error Received messages cannot be mutated by a consumer.
  message.type = "error";
}
