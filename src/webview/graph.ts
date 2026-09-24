import "./graph.css";
import { parseGraphMessage, type GraphRequest, type GraphMessage } from "../graph-protocol";
import { layoutGraph, type GraphRow } from "../graph-layout";
import type { RepositorySnapshot, Reference } from "../repository";

type Words = keyof typeof translations;
const translations = {
  graph: ["コミットグラフ", "Commit Graph"],
  local: ["ローカルブランチ", "Local branches"],
  remote: ["リモートブランチ", "Remote branches"],
  tags: ["タグ", "Tags"],
  all: ["すべてのブランチ", "All branches"],
  fetch: ["Fetch", "Fetch"],
  refresh: ["更新", "Refresh"],
  checkout: ["ブランチ切り替え", "Switch branch"],
  history: ["ファイル履歴", "File history"],
  compare: ["比較", "Compare"],
  common: ["共通祖先から比較", "Compare from merge base"],
  base: ["比較元", "Base"],
  target: ["比較先", "Target"],
  search: ["読み込み済みのコミットを検索…", "Search loaded commits…"],
  message: ["コミットメッセージ", "Commit message"],
  author: ["著者", "Author"],
  date: ["日時", "Date"],
  inspect: ["コミット詳細", "Commit details"],
  select: ["コミットを選択して変更を確認", "Select a commit to inspect changes"],
  changed: ["変更ファイル", "Changed files"],
  loading: ["読み込み中…", "Loading…"],
  empty: [
    "Gitリポジトリを含むフォルダーを開いてください",
    "Open a folder containing a Git repository",
  ],
  noCommits: ["コミットがありません", "No commits yet"],
  more: ["さらに300件を読み込む", "Load 300 more"],
  cached: [
    "リモートはローカルの記録です。Fetchで更新",
    "Remote refs are cached locally. Fetch to update",
  ],
  working: ["未コミットの変更", "Working changes"],
  detached: ["Detached HEAD", "Detached HEAD"],
  noUpstream: ["追跡先なし", "No upstream"],
  gone: ["追跡先が削除されています", "Upstream gone"],
  limit: [
    "5,000件まで表示。ブランチで絞り込めます",
    "Showing up to 5,000 commits. Focus a branch to narrow the history",
  ],
  noChanges: ["ファイルの変更はありません", "No file changes"],
  copy: ["SHAをコピー", "Copy SHA"],
  cherryPick: ["Cherry-pickを確認", "Review cherry-pick"],
  reword: ["メッセージ変更を確認", "Review message change"],
  branch: ["ブランチ / タグ", "Branch / Tag"],
} as const;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function icon(name: string) {
  const node = element("i", "", `codicon codicon-${name}`);
  node.setAttribute("aria-hidden", "true");
  return node;
}
export function mountGraph(app: HTMLElement, post: (message: GraphRequest) => void) {
  let language = 0;
  const t = (key: Words) => translations[key][language];
  let generation = 0;
  let snapshot: RepositorySnapshot | undefined;
  let selected = "";
  let focus = "";
  let query = "";
  let current: Extract<GraphMessage, { type: "graph" }> | undefined;
  let scrollTop = 0;
  let scrollLeft = 0;
  let inspector: HTMLElement;
  let table: HTMLElement;
  let status: HTMLElement;
  let comparing = false;
  let refreshing = false;
  let selectionRequest: Extract<GraphRequest, { type: "inspect" | "compare" }> | undefined;
  let displayedSelection: Extract<GraphMessage, { type: "selection" }> | undefined;
  function markRefreshing(value: boolean) {
    refreshing = value;
    app.setAttribute("aria-busy", String(value));
    app
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")
      .forEach((control) => {
        // Refresh remains available if the previous request failed.
        control.disabled = value && control.getAttribute("aria-label") !== t("refresh");
      });
  }
  const button = (label: string, glyph: string, action: () => void, className = "") => {
    const b = element("button", "", className);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(icon(glyph), element("span", label, "button-label"));
    b.onclick = action;
    return b;
  };
  function badge(ref: Reference) {
    const b = button(
      ref.name,
      ref.kind === "remote" ? "cloud" : ref.kind === "tag" ? "tag" : "git-branch",
      () => post({ type: "focus", ref: ref.id }),
      `ref-label ${ref.kind}`,
    );
    if (ref.current) b.classList.add("current");
    return b;
  }
  function choose(sha: string) {
    if (refreshing) return;
    displayedSelection = undefined;
    inspector.hidden = false;
    selected = sha;
    table.querySelectorAll<HTMLElement>("[data-sha]").forEach((row) => {
      const active = row.dataset.sha === sha;
      row.classList.toggle("selected", active);
      row.setAttribute("aria-selected", String(active));
    });
    inspector.replaceChildren(element("h2", t("inspect")), element("p", t("loading"), "muted"));
    selectionRequest = { type: "inspect", generation, sha };
    post(selectionRequest);
  }
  function draw(canvas: HTMLCanvasElement, row: GraphRow, width: number) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = 28 * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = "28px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 1.6;
    const colors = ["#43bfd1", "#b78ced", "#e4b75d", "#6fba80", "#e881a5", "#649be8"];
    const x = (lane: number) => 12 + lane * 14;
    for (const edge of row.incoming) {
      ctx.strokeStyle = colors[edge.color % colors.length];
      ctx.beginPath();
      ctx.moveTo(x(edge.from), 0);
      ctx.lineTo(x(edge.to), 14);
      ctx.stroke();
    }
    for (const edge of row.outgoing) {
      ctx.strokeStyle = colors[edge.color % colors.length];
      ctx.beginPath();
      ctx.moveTo(x(edge.from), 14);
      ctx.bezierCurveTo(x(edge.from), 22, x(edge.to), 22, x(edge.to), 28);
      ctx.stroke();
    }
    ctx.fillStyle = colors[row.color % colors.length];
    ctx.beginPath();
    ctx.arc(x(row.lane), 14, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
  function renderRows() {
    if (!snapshot) return;
    const rows = layoutGraph(snapshot.commits);
    const width = Math.max(
      64,
      24 + Math.max(0, ...rows.flatMap((r) => [r.lane, ...r.outgoing.map((e) => e.to)])) * 14,
    );
    table.replaceChildren();
    const header = element("div", "", "graph-row graph-columns");
    header.setAttribute("role", "row");
    const graphTitle = element("span", t("graph"));
    graphTitle.style.width = `${width}px`;
    header.append(
      element("span", t("branch")),
      graphTitle,
      element("span", t("message")),
      element("span", t("author")),
      element("span", t("date")),
      element("span", "SHA"),
    );
    table.append(header);
    const q = query.trim().toLocaleLowerCase();
    let hits = 0;
    const refs = new Map<string, Reference[]>();
    snapshot.refs.forEach((r) => refs.set(r.sha, [...(refs.get(r.sha) ?? []), r]));
    snapshot.commits.forEach((commit, index) => {
      const row = element("div", "", "graph-row");
      row.setAttribute("role", "row");
      row.dataset.sha = commit.sha;
      row.tabIndex = 0;
      row.setAttribute(
        "aria-label",
        `${commit.subject} ${commit.author} ${commit.sha.slice(0, 8)}`,
      );
      row.setAttribute("aria-selected", String(selected === commit.sha));
      row.classList.toggle("selected", selected === commit.sha);
      const found =
        !q ||
        `${commit.subject} ${commit.body} ${commit.author} ${commit.sha} ${(refs.get(commit.sha) ?? []).map((r) => r.name).join(" ")}`
          .toLocaleLowerCase()
          .includes(q);
      if (found) hits++;
      else row.classList.add("dimmed");
      row.onclick = () => choose(commit.sha);
      row.onkeydown = (e) => {
        if (e.target !== row) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose(commit.sha);
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
          if (next instanceof HTMLElement && next.dataset.sha) next.focus();
        }
      };
      const labels = element("div", "", "graph-refs");
      if (snapshot?.head === commit.sha) labels.append(element("span", "HEAD", "head-label"));
      for (const ref of refs.get(commit.sha) ?? []) {
        const b = badge(ref);
        b.onclick = (e) => {
          e.stopPropagation();
          post({ type: "focus", ref: ref.id });
        };
        labels.append(b);
      }
      const canvas = element("canvas");
      canvas.setAttribute("aria-hidden", "true");
      draw(canvas, rows[index], width);
      const subject = element("span", commit.subject, "commit-subject");
      subject.title = commit.subject;
      const author = element("span", commit.author, "muted");
      author.title = `${commit.author} <${commit.email}>`;
      const date = element(
        "time",
        new Date(commit.date).toLocaleDateString(language === 0 ? "ja" : "en"),
        "muted",
      );
      date.dateTime = commit.date;
      const sha = button(commit.sha.slice(0, 8), "copy", () => {}, "sha");
      sha.title = t("copy");
      sha.onclick = (e) => {
        e.stopPropagation();
        post({ type: "copy", generation, sha: commit.sha });
      };
      row.append(labels, canvas, subject, author, date, sha);
      table.append(row);
    });
    if (!snapshot.commits.length) table.append(element("p", t("noCommits"), "graph-empty"));
    if (snapshot.truncated && snapshot.commits.length < 5000)
      table.append(button(t("more"), "chevron-down", () => post({ type: "more" }), "load-more"));
    status.textContent = `${snapshot.commits.length} commits${q ? ` · ${hits} matches` : ""} · ${snapshot.truncated && snapshot.commits.length >= 5000 ? t("limit") : t("cached")}`;
  }
  function comparisonForm() {
    const box = element("div", "", "comparison-bar");
    const select = (name: Words) => {
      const input = element("select");
      input.setAttribute("aria-label", t(name));
      for (const ref of snapshot?.refs ?? []) {
        const option = element("option", ref.name);
        option.value = ref.sha;
        input.append(option);
      }
      return input;
    };
    const base = select("base");
    const target = select("target");
    if (snapshot?.head) target.value = snapshot.head;
    const common = element("input");
    common.type = "checkbox";
    common.checked = true;
    const label = element("label", t("common"));
    label.prepend(common);
    box.append(
      element("span", t("base")),
      base,
      element("span", t("target")),
      target,
      label,
      button(t("compare"), "git-compare", () => {
        if (!base.value || !target.value) return;
        inspector.hidden = false;
        inspector.replaceChildren(element("h2", t("compare")), element("p", t("loading"), "muted"));
        selected = "";
        displayedSelection = undefined;
        selectionRequest = {
          type: "compare",
          generation,
          base: base.value,
          target: target.value,
          commonBase: common.checked,
        };
        post(selectionRequest);
      }),
    );
    return box;
  }
  function render(message: Extract<GraphMessage, { type: "graph" }>, force = false) {
    if (message.generation < generation) return;
    const sameContext =
      current?.repository === message.repository &&
      current?.focus === message.focus &&
      current?.locale === message.locale &&
      JSON.stringify(current?.repositories) === JSON.stringify(message.repositories);
    const unchanged =
      sameContext &&
      snapshot &&
      message.state.status === "ready" &&
      JSON.stringify(snapshot) === JSON.stringify(message.state.snapshot);
    if (
      !force &&
      sameContext &&
      snapshot &&
      (message.state.status === "loading" || message.state.status === "error" || unchanged)
    ) {
      current = message;
      generation = message.generation;
      markRefreshing(message.state.status !== "ready");
      const notice = app.querySelector<HTMLElement>("#graph-error");
      if (notice)
        notice.textContent = message.state.status === "error" ? message.state.message : "";
      if (unchanged && selectionRequest && generation !== displayedSelection?.generation) {
        // Revalidate the selection token without removing its visible contents.
        inspector.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
          control.disabled = true;
        });
        selectionRequest = { ...selectionRequest, generation };
        post(selectionRequest);
      }
      return;
    }
    if (!sameContext) {
      selected = "";
      selectionRequest = undefined;
    }
    displayedSelection = undefined;
    selectionRequest = undefined;
    if (current?.repository !== message.repository || current?.focus !== message.focus) {
      scrollTop = 0;
      scrollLeft = 0;
    } else if (snapshot) {
      scrollTop = table.scrollTop;
      scrollLeft = table.scrollLeft;
    }
    // Keep the last ready position across intermediate loading/error messages.
    current = message;
    generation = message.generation;
    language = message.locale.startsWith("ja") ? 0 : 1;
    focus = message.focus;
    snapshot = message.state.status === "ready" ? message.state.snapshot : undefined;
    app.replaceChildren();
    app.className = "workbench";
    refreshing = false;
    app.setAttribute("aria-busy", "false");
    const top = element("header", "", "graph-toolbar");
    const repos = element("select");
    repos.setAttribute("aria-label", language === 0 ? "リポジトリ" : "Repository");
    for (const repo of message.repositories) {
      const option = element("option", repo.name);
      option.value = repo.id;
      repos.append(option);
    }
    repos.value = message.repository;
    repos.onchange = () => post({ type: "repository", id: repos.value });
    top.append(
      icon("repo"),
      repos,
      button(snapshot?.branch || t("checkout"), "git-branch", () => post({ type: "checkout" })),
      button(t("fetch"), "cloud-download", () => post({ type: "fetch" })),
      button(t("refresh"), "refresh", () => post({ type: "refresh" })),
      button(t("history"), "history", () => post({ type: "history" })),
    );
    const comparison = button(t("compare"), "git-compare", () => {
      comparing = !comparing;
      if (current) render(current, true);
    });
    top.append(comparison);
    const search = element("input");
    search.type = "search";
    search.placeholder = t("search");
    search.setAttribute("aria-label", t("search"));
    search.value = query;
    search.oninput = () => {
      query = search.value;
      renderRows();
      if (refreshing) markRefreshing(true);
    };
    top.append(search);
    app.append(top);
    const notice = element("div", "", "graph-notice");
    notice.id = "graph-error";
    notice.setAttribute("role", "alert");
    app.append(notice);
    if (comparing && snapshot) app.append(comparisonForm());
    const body = element("div", "", "graph-body");
    const sidebar = element("aside", "", "graph-sidebar");
    sidebar.append(
      button(t("all"), "repo", () => post({ type: "focus", ref: "" }), focus ? "" : "active"),
    );
    for (const [kind, key] of [
      ["local", "local"],
      ["remote", "remote"],
      ["tag", "tags"],
    ] as const) {
      const section = element("details");
      section.open = true;
      const list = snapshot?.refs.filter((r) => r.kind === kind) ?? [];
      section.append(element("summary", `${t(key)} (${list.length})`));
      for (const ref of list) {
        const b = button(
          ref.name,
          kind === "remote" ? "cloud" : kind === "tag" ? "tag" : "git-branch",
          () => post({ type: "focus", ref: ref.id }),
          "branch-item",
        );
        b.classList.toggle("active", focus === ref.id);
        b.classList.toggle("current", ref.current);
        if (ref.current) b.append(icon("check"));
        if (ref.tracking === "tracked") {
          const counts = element("span", "", "tracking");
          counts.append(
            icon("arrow-up"),
            element("span", String(ref.ahead)),
            icon("arrow-down"),
            element("span", String(ref.behind)),
          );
          counts.title = `${ref.upstream}: ${ref.ahead} ahead, ${ref.behind} behind`;
          b.append(counts);
        }
        b.title = `${ref.name}\n${ref.tracking === "gone" ? t("gone") : ref.upstream || (kind === "local" ? t("noUpstream") : ref.sha)}`;
        section.append(b);
      }
      sidebar.append(section);
    }
    const center = element("section", "", "graph-center");
    const heading = element("div", "", "graph-context");
    heading.append(
      element(
        "strong",
        focus ? (snapshot?.refs.find((r) => r.id === focus)?.name ?? focus) : t("all"),
      ),
    );
    if (snapshot) heading.append(element("span", `${snapshot.changed} ${t("working")}`, "muted"));
    center.append(heading);
    table = element("div", "", "graph-table");
    table.setAttribute("role", "grid");
    table.setAttribute("aria-label", t("graph"));
    center.append(table);
    inspector = element("aside", "", "graph-inspector");
    inspector.hidden = true;
    inspector.append(element("h2", t("inspect")), element("p", t("select"), "muted"));
    body.append(sidebar, center, inspector);
    app.append(body);
    status = element("footer", "", "graph-status");
    status.setAttribute("role", "status");
    app.append(status);
    if (snapshot) {
      renderRows();
      if (selected && snapshot.commits.some((c) => c.sha === selected)) choose(selected);
      table.scrollTop = scrollTop;
      table.scrollLeft = scrollLeft;
    } else if (message.state.status === "error") {
      notice.textContent = message.state.message;
      table.append(button(t("all"), "repo", () => post({ type: "focus", ref: "" })));
    } else
      table.append(
        element("p", t(message.state.status === "loading" ? "loading" : "empty"), "graph-empty"),
      );
  }
  window.addEventListener("message", (event) => {
    const message = parseGraphMessage(event.data);
    if (!message) return;
    if (message.type === "graph") render(message);
    else if (message.type === "graphError") {
      const notice = document.getElementById("graph-error");
      if (notice) notice.textContent = message.message;
    } else if (message.generation === generation && !refreshing) {
      const unchanged =
        displayedSelection &&
        JSON.stringify(displayedSelection.value) === JSON.stringify(message.value);
      displayedSelection = message;
      if (unchanged) {
        inspector.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
          control.disabled = false;
        });
        return;
      }
      inspector.hidden = false;
      const value = message.value;
      const commit = snapshot?.commits.find((c) => c.sha === value.after);
      inspector.replaceChildren(
        element("h2", value.title),
        element(
          "code",
          `${value.before?.slice(0, 8) ?? "∅"} → ${value.after.slice(0, 8)}`,
          "muted",
        ),
      );
      if (commit)
        inspector.append(element("p", commit.author), element("p", commit.body, "commit-body"));
      if (commit && commit.sha === selected) {
        const controls = element("div");
        controls.append(
          button(t("cherryPick"), "git-commit", () =>
            post({ type: "operation", generation, sha: commit.sha, kind: "cherry-pick" }),
          ),
          button(t("reword"), "edit", () =>
            post({ type: "operation", generation, sha: commit.sha, kind: "reword" }),
          ),
        );
        inspector.append(controls);
      }
      inspector.append(element("h3", `${t("changed")} (${value.changes.length})`));
      if (!value.changes.length) inspector.append(element("p", t("noChanges"), "muted"));
      for (const change of value.changes) {
        const b = button(
          change.path,
          "files",
          () =>
            post({
              type: "diff",
              generation,
              selection: displayedSelection?.selection ?? message.selection,
              path: change.path,
            }),
          "changed-file",
        );
        b.title = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
        b.append(
          element("span", change.status, `change-kind status-${change.status}`),
          element("span", `+${change.added}`, "added"),
          element("span", `−${change.deleted}`, "deleted"),
        );
        inspector.append(b);
      }
    }
  });
}
