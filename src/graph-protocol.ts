import type { RepositorySnapshot, Reference, RevisionSelection } from "./repository";
import { isCommit, isChange } from "./protocol";
import { isOperationKind, type OperationKind } from "./commit-operation-kind";
const isSha = (v: unknown): v is string =>
  typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
export interface RepositoryOption {
  readonly id: string;
  readonly name: string;
}
export type GraphRequest =
  | { type: "ready" | "refresh" | "fetch" | "checkout" | "history" }
  | { type: "repository"; id: string }
  | { type: "focus"; ref: string }
  | { type: "more" }
  | { type: "inspect"; generation: number; sha: string }
  | { type: "copy"; generation: number; sha: string }
  | { type: "operation"; generation: number; sha: string; kind: OperationKind }
  | { type: "compare"; generation: number; base: string; target: string; commonBase: boolean }
  | { type: "diff"; generation: number; selection: number; path: string };
interface Context {
  readonly repositories: readonly RepositoryOption[];
  readonly repository: string;
  readonly generation: number;
  readonly locale: string;
  readonly focus: string;
}
export type GraphMessage =
  | (Context & {
      type: "graph";
      state:
        | { status: "loading" | "empty" }
        | { status: "error"; message: string }
        | { status: "ready"; snapshot: RepositorySnapshot };
    })
  | { type: "selection"; generation: number; selection: number; value: RevisionSelection }
  | { type: "graphError"; message: string };
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown): v is string => typeof v === "string";
const number = (v: unknown): v is number =>
  Number.isSafeInteger(v) && typeof v === "number" && v >= 0;
const array = <T>(v: unknown, guard: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(guard);
export function parseGraphRequest(v: unknown): GraphRequest | undefined {
  if (!object(v)) return;
  switch (v.type) {
    case "operation":
      if (number(v.generation) && isSha(v.sha) && isOperationKind(v.kind))
        return { type: v.type, generation: v.generation, sha: v.sha, kind: v.kind };
      return;
    case "ready":
    case "refresh":
    case "fetch":
    case "checkout":
    case "history":
    case "more":
      return { type: v.type };
    case "repository":
      if (text(v.id)) return { type: v.type, id: v.id };
      return;
    case "focus":
      if (text(v.ref)) return { type: v.type, ref: v.ref };
      return;
    case "inspect":
    case "copy":
      if (number(v.generation) && isSha(v.sha))
        return { type: v.type, generation: v.generation, sha: v.sha };
      return;
    case "compare":
      if (
        number(v.generation) &&
        isSha(v.base) &&
        isSha(v.target) &&
        typeof v.commonBase === "boolean"
      )
        return {
          type: v.type,
          generation: v.generation,
          base: v.base,
          target: v.target,
          commonBase: v.commonBase,
        };
      return;
    case "diff":
      if (number(v.generation) && number(v.selection) && text(v.path))
        return { type: v.type, generation: v.generation, selection: v.selection, path: v.path };
      return;
  }
}
function reference(v: unknown): v is Reference {
  return (
    object(v) &&
    text(v.id) &&
    text(v.name) &&
    ["local", "remote", "tag"].includes(String(v.kind)) &&
    isSha(v.sha) &&
    typeof v.current === "boolean" &&
    text(v.upstream) &&
    ["none", "tracked", "gone"].includes(String(v.tracking)) &&
    number(v.ahead) &&
    number(v.behind)
  );
}
function snapshot(v: unknown): v is RepositorySnapshot {
  return (
    object(v) &&
    array(v.commits, isCommit) &&
    array(v.refs, reference) &&
    (v.head === null || isSha(v.head)) &&
    text(v.branch) &&
    number(v.changed) &&
    array(v.remotes, text) &&
    typeof v.truncated === "boolean"
  );
}
function option(v: unknown): v is RepositoryOption {
  return object(v) && text(v.id) && text(v.name);
}
function selection(v: unknown): v is RevisionSelection {
  return (
    object(v) &&
    (v.before === null || isSha(v.before)) &&
    isSha(v.after) &&
    text(v.title) &&
    array(v.changes, isChange)
  );
}
export function parseGraphMessage(v: unknown): GraphMessage | undefined {
  if (!object(v)) return;
  if (v.type === "graphError" && text(v.message)) return { type: v.type, message: v.message };
  if (v.type === "selection" && number(v.generation) && number(v.selection) && selection(v.value))
    return { type: v.type, generation: v.generation, selection: v.selection, value: v.value };
  if (
    v.type !== "graph" ||
    !array(v.repositories, option) ||
    !text(v.repository) ||
    !number(v.generation) ||
    !text(v.locale) ||
    !text(v.focus) ||
    !object(v.state)
  )
    return;
  const context: Context = {
    repositories: v.repositories,
    repository: v.repository,
    generation: v.generation,
    locale: v.locale,
    focus: v.focus,
  };
  switch (v.state.status) {
    case "empty":
    case "loading":
      return { ...context, type: "graph", state: { status: v.state.status } };
    case "error":
      if (text(v.state.message))
        return { ...context, type: "graph", state: { status: "error", message: v.state.message } };
      return;
    case "ready":
      if (snapshot(v.state.snapshot))
        return {
          ...context,
          type: "graph",
          state: { status: "ready", snapshot: v.state.snapshot },
        };
      return;
  }
}
