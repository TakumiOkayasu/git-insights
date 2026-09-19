import "./style.css";
import { mountGraph } from "./graph";
import { mountOperation } from "./operation";
import type { Commit, Change } from "../git";
import { translateLabels, type LabelKey } from "../labels";
import {
  parseHostMessage,
  isAction,
  unreachable,
  type HistoryMessage,
  type TodoMessage,
  type HistoryAction,
  type RebaseRequest,
  type WebviewRequest,
} from "../protocol";
import { actions, type TodoRow } from "../rebase";
import { decodeAvatar } from "../avatar";
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const app = document.getElementById("app")!;
if (document.body.dataset.mode === "graph")
  mountGraph(app, (message) => vscode.postMessage(message));
if (document.body.dataset.mode === "operation")
  mountOperation(app, (message) => vscode.postMessage(message));
let labels = translateLabels((key) => key);
let locale = "en";
let generation = 0;
const t = (key: LabelKey) => labels[key] ?? key;
const send = (data: HistoryAction | RebaseRequest) => {
  const request: WebviewRequest = "sha" in data ? { ...data, generation } : data;
  vscode.postMessage(request);
};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function button(text: string, callback: () => void, title = text) {
  const b = el("button", text);
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.onclick = callback;
  return b;
}
function relative(date: string) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  const units = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const;
  const [size, unit] = units.find(([size]) => Math.abs(seconds) >= size) ?? units[3];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(seconds / size),
    unit,
  );
}
function group(date: string) {
  const now = new Date();
  const value = new Date(date);
  if (now.toDateString() === value.toDateString()) return "Today";
  const week = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  );
  if (value >= week) return "This week";
  if (now.getTime() - value.getTime() < 7 * 86400000) return "Last week";
  return now.getTime() - value.getTime() < 30 * 86400000 ? "Over a week ago" : "Over a month ago";
}
const details = new Map<string, { element: HTMLElement; commit: Commit; loaded: boolean }>();
const avatars = new Map<string, HTMLElement>();
function renderHistory(state: HistoryMessage) {
  const { context, result } = state;
  generation = state.generation;
  details.clear();
  avatars.clear();
  app.replaceChildren();
  const header = el("header");
  const scope = el("nav");
  scope.setAttribute("aria-label", "Git Insights");
  for (const mode of ["file", "line"] as const) {
    const b = button(t(mode === "file" ? "File" : "Line"), () => send({ type: "scope", mode }));
    b.setAttribute("aria-pressed", String(context.mode === mode));
    scope.append(b);
  }
  header.append(
    scope,
    button("↻", () => send({ type: "refresh" }), t("Refresh")),
    button(
      state.pinned ? "◆" : "◇",
      () => send({ type: "pin" }),
      t(state.pinned ? "Unpin" : "Pin"),
    ),
  );
  const file = el(
    "div",
    context.file !== null
      ? context.file.split(/[\\/]/).pop() +
          (context.mode === "line" ? `:${context.range.join("–")}` : "")
      : "Git Insights",
    "file",
  );
  file.title = context.file ?? "";
  header.append(file);
  app.append(header);
  const notices = {
    empty: t("Open a tracked file to see its history."),
    loading: t("Loading…"),
    error: result.status === "error" ? result.notice : "",
    ready: result.status === "ready" && !result.commits.length ? t("No history found.") : "",
  } satisfies Record<HistoryMessage["result"]["status"], string>;
  const status = el("p", notices[result.status], "status");
  status.setAttribute("role", "status");
  app.append(status);
  const timeline = el("section", "", "timeline");
  app.append(timeline);
  let previousGroup = "";
  for (const commit of result.status === "ready" ? result.commits : []) {
    const category = group(commit.date);
    if (category !== previousGroup) {
      timeline.append(el("h2", t(category)));
      previousGroup = category;
    }
    const entry = el("article", "", "entry");
    const row = el("div", "", "row");
    const body = el("section", "", "details");
    body.hidden = true;
    const detail = { element: body, commit, loaded: false };
    details.set(commit.sha, detail);
    const toggle = button(commit.subject, () => {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", String(!body.hidden));
      if (!body.hidden && !detail.loaded) {
        body.replaceChildren(el("p", t("Loading…")));
        send({ type: "details", sha: commit.sha });
      }
    });
    toggle.className = "subject";
    toggle.setAttribute("aria-expanded", "false");
    const time = el("time", relative(commit.date));
    time.dateTime = commit.date;
    time.title = new Date(commit.date).toLocaleString(locale);
    row.append(toggle, time);
    const meta = el("div", "", "meta");
    const avatar = el("span", commit.author.slice(0, 1).toUpperCase(), "avatar");
    avatars.set(commit.sha, avatar);
    const hash = button(
      commit.sha.slice(0, 8),
      () => send({ type: "copy", sha: commit.sha }),
      t("Copy SHA"),
    );
    hash.className = "hash";
    meta.append(
      avatar,
      el("span", commit.author),
      hash,
      button("↗", () => send({ type: "remote", sha: commit.sha }), t("Open on remote")),
    );
    entry.append(row, meta, body);
    timeline.append(entry);
  }
  if (result.status === "ready" && result.truncated)
    app.append(
      el("p", t("History limit reached. Increase the limit in settings to see more."), "status"),
    );
}
function renderDetails(sha: string, changes: readonly Change[]) {
  const detail = details.get(sha);
  if (!detail) return;
  const { element: body, commit } = detail;
  detail.loaded = true;
  body.replaceChildren();
  body.append(
    el("div", `${t("Author")}: ${commit.author} <${commit.email}>`),
    el("div", new Date(commit.date).toLocaleString(locale)),
    button(commit.sha, () => send({ type: "copy", sha }), t("Copy SHA")),
  );
  if (commit.body) body.append(el("pre", commit.body));
  body.append(el("h3", `${t("Files changed")} (${changes.length})`));
  for (const change of changes) {
    const b = button(
      "",
      () => send({ type: "diff", sha, path: change.path }),
      `${t("Open diff")}: ${change.path}`,
    );
    b.className = "change";
    b.append(
      el("span", change.status, `badge ${change.status}`),
      el("span", change.oldPath ? `${change.oldPath} → ${change.path}` : change.path, "path"),
      el("span", `+${change.added}`, "added"),
      el("span", `−${change.deleted}`, "deleted"),
    );
    body.append(b);
  }
}

let rows: TodoRow[] = [];
let version = 0;
let drag: number | undefined;
let pending = false;
function renderTodo(state: TodoMessage) {
  rows = state.rows.map((row) => ({ ...row }));
  version = state.version;
  pending = false;
  app.replaceChildren();
  app.append(
    el("h1", t("Rebase editor")),
    el("p", t("Save the plan, then close this tab to let Git continue.")),
  );
  const toolbar = el("div", "", "toolbar");
  const save = button(t("Save"), () => {
    if (pending) return;
    pending = true;
    save.disabled = true;
    send({ type: "save", rows, version });
  });
  save.disabled = !state.supported;
  toolbar.append(
    save,
    button(t("Open as text"), () => send({ type: "text" })),
  );
  app.append(toolbar);
  const error = el(
    "p",
    state.supported ? "" : t("Advanced rebase commands require the text editor."),
    "error",
  );
  error.id = "error";
  error.setAttribute("role", "alert");
  app.append(error);
  const list = el("ol", "", "todo");
  app.append(list);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || pending) return;
    const [row] = rows.splice(from, 1);
    rows.splice(to, 0, row);
    draw();
  };
  const draw = () => {
    list.replaceChildren();
    rows.forEach((row, index) => {
      const item = el("li");
      item.draggable = state.supported && !pending;
      item.ondragstart = (e) => {
        drag = index;
        e.dataTransfer?.setData("text/plain", String(index));
      };
      item.ondragover = (e) => e.preventDefault();
      item.ondrop = (e) => {
        e.preventDefault();
        if (drag !== undefined) move(drag, index);
        drag = undefined;
      };
      item.ondragend = () => {
        drag = undefined;
      };
      const select = el("select");
      select.setAttribute("aria-label", `${t("Action")}: ${row.sha}`);
      select.disabled = !state.supported || pending;
      for (const action of actions) {
        const option = el("option", action);
        option.value = action;
        select.append(option);
      }
      select.value = row.action;
      select.onchange = () => {
        if (isAction(select.value)) row.action = select.value;
      };
      const up = button("↑", () => move(index, index - 1), t("Move up"));
      up.disabled = !state.supported || index === 0;
      const down = button("↓", () => move(index, index + 1), t("Move down"));
      down.disabled = !state.supported || index === rows.length - 1;
      item.append(up, down, select, el("code", row.sha), el("span", row.message));
      list.append(item);
    });
  };
  draw();
}
window.addEventListener("message", (event) => {
  const m = parseHostMessage(event.data);
  if (!m) return;
  if ("labels" in m) {
    labels = m.labels;
    locale = m.locale;
  }
  switch (m.type) {
    case "history":
      renderHistory(m);
      break;
    case "details":
      if (m.generation === generation) renderDetails(m.sha, m.changes);
      break;
    case "avatar":
      {
        if (m.generation !== generation) break;
        const avatar = avatars.get(m.sha);
        const decoded = decodeAvatar(m.avatar);
        if (avatar && decoded) {
          const img = el("img");
          const url = URL.createObjectURL(new Blob([decoded.bytes], { type: decoded.mime }));
          img.onload = img.onerror = () => URL.revokeObjectURL(url);
          img.src = url;
          img.alt = "";
          avatar.replaceChildren(img);
        }
      }
      break;
    case "todo":
      renderTodo(m);
      break;
    case "error": {
      pending = false;
      const error = document.getElementById("error");
      if (error) error.textContent = m.message;
      const save = app.querySelector<HTMLButtonElement>(".toolbar button");
      if (save) save.disabled = false;
      break;
    }
    default:
      unreachable(m);
  }
});
send({ type: "ready" });
