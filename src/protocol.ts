// Wire/presentation contracts only. These are not domain collaborator interfaces.
import type { Commit, Change } from "./git";
import { isAction, type TodoRow } from "./rebase";
export { isAction } from "./rebase";
import { labelKeys, type Labels } from "./labels";

export type Scope = "file" | "line";
export type LineRange = readonly [start: number, end: number];
export type HistoryContext =
  | { readonly mode: Scope; readonly file: null }
  | { readonly mode: "file"; readonly file: string }
  | { readonly mode: "line"; readonly file: string; readonly range: LineRange };
export type HistoryResult =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly notice: string }
  | { readonly status: "ready"; readonly commits: readonly Commit[]; readonly truncated: boolean };
interface Localized {
  readonly labels: Labels;
  readonly locale: string;
}
export type HistoryMessage = Localized & {
  readonly type: "history";
  readonly generation: number;
  readonly context: HistoryContext;
  readonly pinned: boolean;
  readonly result: HistoryResult;
};
export type TodoMessage = Localized & {
  readonly type: "todo";
  readonly version: number;
  readonly supported: boolean;
  readonly rows: readonly TodoRow[];
};
export type HostMessage =
  | HistoryMessage
  | TodoMessage
  | {
      readonly type: "details";
      readonly generation: number;
      readonly sha: string;
      readonly changes: readonly Change[];
    }
  | {
      readonly type: "avatar";
      readonly generation: number;
      readonly sha: string;
      readonly avatar: string;
    }
  | { readonly type: "error"; readonly message: string };
type CommitRequest = { readonly generation: number; readonly sha: string };
export type HistoryRequest =
  | { readonly type: "ready" | "refresh" | "pin" }
  | { readonly type: "scope"; readonly mode: Scope }
  | (CommitRequest & { readonly type: "copy" | "remote" | "details" })
  | (CommitRequest & { readonly type: "diff"; readonly path: string });
export type RebaseRequest =
  | { readonly type: "ready" | "text" }
  | { readonly type: "save"; readonly version: number; readonly rows: readonly TodoRow[] };
export type WebviewRequest = HistoryRequest | RebaseRequest;
export type HistoryAction = HistoryRequest extends infer R
  ? R extends CommitRequest
    ? Omit<R, "generation">
    : R
  : never;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const strings = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => typeof value[key] === "string");
const arrayOf = <T>(value: unknown, guard: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every(guard);
const row = (v: unknown): v is TodoRow =>
  record(v) &&
  integer(v.id) &&
  isAction(v.action) &&
  typeof v.sha === "string" &&
  /^[a-f0-9]{4,64}$/.test(v.sha) &&
  typeof v.message === "string";
const commit = (v: unknown): v is Commit =>
  record(v) &&
  sha(v.sha) &&
  arrayOf(v.parents, sha) &&
  strings(v, ["author", "email", "date", "subject", "body"]) &&
  Number.isFinite(Date.parse(String(v.date)));
const change = (v: unknown): v is Change =>
  record(v) &&
  strings(v, ["status", "path", "added", "deleted"]) &&
  (v.oldPath === undefined || typeof v.oldPath === "string");
const localized = (v: Record<string, unknown>): v is Record<string, unknown> & Localized => {
  const labels = v.labels;
  return (
    record(labels) &&
    labelKeys.every((key) => typeof labels[key] === "string") &&
    typeof v.locale === "string" &&
    validLocale(v.locale)
  );
};
function validLocale(value: string) {
  try {
    new Intl.DateTimeFormat(value);
    return true;
  } catch {
    return false;
  }
}
function context(v: unknown): v is HistoryContext {
  if (!record(v) || (v.mode !== "file" && v.mode !== "line")) return false;
  if (v.file === null) return true;
  if (typeof v.file !== "string") return false;
  return (
    v.mode === "file" ||
    (Array.isArray(v.range) &&
      v.range.length === 2 &&
      integer(v.range[0]) &&
      v.range[0] > 0 &&
      integer(v.range[1]) &&
      v.range[1] >= v.range[0])
  );
}
function result(v: unknown): v is HistoryResult {
  if (!record(v)) return false;
  switch (v.status) {
    case "empty":
    case "loading":
      return true;
    case "error":
      return typeof v.notice === "string";
    case "ready":
      return arrayOf(v.commits, commit) && typeof v.truncated === "boolean";
    default:
      return false;
  }
}
export function parseHistoryRequest(value: unknown): HistoryRequest | undefined {
  if (!record(value)) return;
  switch (value.type) {
    case "ready":
    case "refresh":
    case "pin":
      return { type: value.type };
    case "scope":
      if (value.mode === "file" || value.mode === "line")
        return { type: "scope", mode: value.mode };
      return;
    case "copy":
    case "remote":
    case "details":
      if (integer(value.generation) && sha(value.sha))
        return { type: value.type, generation: value.generation, sha: value.sha };
      return;
    case "diff":
      if (integer(value.generation) && sha(value.sha) && typeof value.path === "string")
        return { type: "diff", generation: value.generation, sha: value.sha, path: value.path };
      return;
    default:
      return;
  }
}
export function parseRebaseRequest(value: unknown): RebaseRequest | undefined {
  if (!record(value)) return;
  if (value.type === "ready" || value.type === "text") return { type: value.type };
  if (value.type === "save" && integer(value.version) && arrayOf(value.rows, row))
    return { type: "save", version: value.version, rows: value.rows.map((r) => ({ ...r })) };
}
export function parseHostMessage(value: unknown): HostMessage | undefined {
  if (!record(value)) return;
  switch (value.type) {
    case "history":
      if (
        integer(value.generation) &&
        context(value.context) &&
        result(value.result) &&
        typeof value.pinned === "boolean" &&
        localized(value)
      )
        return {
          type: "history",
          generation: value.generation,
          context: value.context,
          result: value.result,
          pinned: value.pinned,
          labels: value.labels,
          locale: value.locale,
        };
      return;
    case "todo":
      if (
        integer(value.version) &&
        typeof value.supported === "boolean" &&
        arrayOf(value.rows, row) &&
        localized(value)
      )
        return {
          type: "todo",
          version: value.version,
          supported: value.supported,
          rows: value.rows,
          labels: value.labels,
          locale: value.locale,
        };
      return;
    case "details":
      if (integer(value.generation) && sha(value.sha) && arrayOf(value.changes, change))
        return {
          type: "details",
          generation: value.generation,
          sha: value.sha,
          changes: value.changes,
        };
      return;
    case "avatar":
      if (integer(value.generation) && sha(value.sha) && typeof value.avatar === "string")
        return {
          type: "avatar",
          generation: value.generation,
          sha: value.sha,
          avatar: value.avatar,
        };
      return;
    case "error":
      if (typeof value.message === "string") return { type: "error", message: value.message };
      return;
    default:
      return;
  }
}
export function unreachable(value: never): never {
  throw new Error(`Unhandled message: ${String(value)}`);
}
