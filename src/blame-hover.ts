import * as vscode from "vscode";
import type { Change, Commit } from "./git";
import { decodeAvatar } from "./avatar";

export const blameCommands = {
  copy: "gitInsights.blame.copySha",
  remote: "gitInsights.blame.openRemote",
  settings: "gitInsights.blame.settings",
} as const;

export type BlameDetails = {
  changes?: Change[];
  avatar?: string;
  remoteUrl?: string;
  statisticsFailed?: boolean;
};

function relativeDate(date: Date, now: number) {
  const seconds = (date.getTime() - now) / 1000;
  const units = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const;
  const [size, unit] = units.find(([size]) => Math.abs(seconds) >= size) ?? units[5];
  return new Intl.RelativeTimeFormat(vscode.env.language, { numeric: "auto" }).format(
    Math.trunc(seconds / size),
    unit,
  );
}

export function blameHover(
  commit: Commit | undefined,
  details: BlameDetails,
  generation: number,
  now = Date.now(),
) {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.supportHtml = true;
  markdown.isTrusted = { enabledCommands: Object.values(blameCommands) };
  const link = (icon: string, label: string, command: string) =>
    markdown.appendMarkdown(
      `[$(${icon}) ${label}](command:${command}?${encodeURIComponent(JSON.stringify([generation]))})`,
    );
  if (!commit) {
    markdown.appendText(vscode.l10n.t("Uncommitted changes"));
    markdown.appendMarkdown("\n\n");
    link("gear", vscode.l10n.t("Settings"), blameCommands.settings);
    return markdown;
  }
  if (details.avatar && decodeAvatar(details.avatar))
    markdown.appendMarkdown(`<img src="${details.avatar}" width="20" height="20" /> `);
  // Only our layout is Markdown; repository-controlled text is always escaped.
  markdown.appendMarkdown("**");
  markdown.appendText(commit.author);
  markdown.appendMarkdown("** · $(history) ");
  const date = new Date(commit.date);
  markdown.appendText(`${relativeDate(date, now)} (${date.toLocaleString(vscode.env.language)})`);
  markdown.appendMarkdown("\n\n");
  markdown.appendText(commit.subject);
  if (commit.body.trim()) {
    markdown.appendMarkdown("\n\n");
    markdown.appendText(commit.body.trim());
  }
  markdown.appendMarkdown("\n\n");
  if (details.changes) {
    let added = 0;
    let deleted = 0;
    let binary = 0;
    for (const change of details.changes) {
      if (change.added === "-" || change.deleted === "-") binary++;
      else {
        added += Number(change.added);
        deleted += Number(change.deleted);
      }
    }
    markdown.appendText(vscode.l10n.t("{0} files changed", details.changes.length));
    markdown.appendMarkdown(
      ', <span style="color:var(--vscode-gitDecoration-addedResourceForeground);">',
    );
    markdown.appendText(vscode.l10n.t("{0} insertions (+)", added));
    markdown.appendMarkdown(
      '</span>, <span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">',
    );
    markdown.appendText(vscode.l10n.t("{0} deletions (-)", deleted));
    markdown.appendMarkdown("</span>");
    if (binary) markdown.appendText(` · ${vscode.l10n.t("{0} binary files", binary)}`);
  } else {
    markdown.appendText(
      vscode.l10n.t(details.statisticsFailed ? "Change statistics unavailable." : "Loading…"),
    );
  }
  markdown.appendMarkdown("\n\n---\n\n$(git-commit) ");
  markdown.appendMarkdown(`<span title="${commit.sha}">${commit.sha.slice(0, 7)}</span> · `);
  link("copy", vscode.l10n.t("Copy SHA"), blameCommands.copy);
  if (details.remoteUrl) {
    markdown.appendMarkdown(" · ");
    const provider = new URL(details.remoteUrl).hostname;
    const name = { "github.com": "GitHub", "gitlab.com": "GitLab", "bitbucket.org": "Bitbucket" }[
      provider
    ];
    link("link-external", vscode.l10n.t("Open in {0}", name ?? provider), blameCommands.remote);
  }
  markdown.appendMarkdown(" · ");
  link("gear", vscode.l10n.t("Settings"), blameCommands.settings);
  markdown.appendMarkdown("\n\n");
  markdown.appendText(commit.email);
  return markdown;
}
