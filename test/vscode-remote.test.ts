import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { remoteCommitUrl } from "../src/vscode-remote";

const host = vi.hoisted(() => ({
  configuration: vi.fn(),
  settings: new Map<string, unknown>(),
}));
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (section: string, resource: { fsPath: string }) => {
      host.configuration(section, resource);
      return { get: () => host.settings.get(resource.fsPath) ?? "" };
    },
  },
}));
const sha = "a".repeat(40);
const remote = "work-gitlab:group/project.git";
const resource = (fsPath: string) => ({ fsPath }) as vscode.Uri;
beforeEach(() => {
  vi.clearAllMocks();
  host.settings.clear();
});

it("Gitルートの下に開いたフォルダーでも、対象ファイルの設定スコープを使う", () => {
  const file = resource("/repo/frontend/file.ts");
  host.settings.set(file.fsPath, "https://gitlab.example.invalid/team/frontend");
  expect(remoteCommitUrl(file, remote, sha)).toBe(
    `https://gitlab.example.invalid/team/frontend/-/commit/${sha}`,
  );
  expect(host.configuration).toHaveBeenCalledWith("gitInsights", file);
});

it("複数フォルダーの設定を混同せず、変更・削除を毎回読み直す", () => {
  const first = resource("/first/file.ts");
  const second = resource("/second/file.ts");
  host.settings.set(first.fsPath, "https://gitlab.example.invalid/team/first");
  host.settings.set(second.fsPath, "https://gitlab.example.invalid/team/second");
  expect(remoteCommitUrl(first, remote, sha)).toContain("/team/first/-/commit/");
  expect(remoteCommitUrl(second, remote, sha)).toContain("/team/second/-/commit/");
  host.settings.set(first.fsPath, "https://gitlab.example.invalid/team/renamed");
  expect(remoteCommitUrl(first, remote, sha)).toContain("/team/renamed/-/commit/");
  host.settings.delete(first.fsPath);
  expect(remoteCommitUrl(first, remote, sha)).toBeUndefined();
  expect(remoteCommitUrl(second, remote, sha)).toContain("/team/second/-/commit/");
});
