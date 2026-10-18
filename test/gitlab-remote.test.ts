import { describe, expect, it } from "vitest";
import { remoteCommitUrl } from "../src/git";

const sha = "a".repeat(40);
const projectUrl = "https://gitlab.example.invalid:8443/gitlab/group/subgroup/project";

describe("セルフホストGitLabのコミットリンク", () => {
  it.each([
    "https://gitlab.example.invalid:8443/gitlab/group/subgroup/project.git",
    "git@gitlab.example.invalid:group/subgroup/project.git",
    "ssh://git@gitlab.example.invalid:2222/group/subgroup/project.git",
    "git@work-gitlab:group/subgroup/project.git",
    "git@work-gitlab:/group/subgroup/project.git",
    "work-gitlab:group/subgroup/project.git",
    "ssh://work-gitlab:2222/group/subgroup/project.git",
    "deploy@work-gitlab:group/subgroup/project.git",
    "ssh://deploy@work-gitlab:2222/group/subgroup/project.git",
    "ssh://git@ssh.example.invalid:2222/group/subgroup/project.git",
  ])("remoteの形式やSSHホスト名に依存せず設定済みプロジェクトを開く: %s", (remote) => {
    expect(remoteCommitUrl(remote, sha, projectUrl)).toBe(`${projectUrl}/-/commit/${sha}`);
  });

  it.each([projectUrl + "/", projectUrl + ".git", projectUrl + ".git/"])(
    "設定の末尾を正規化する: %s",
    (configured) => {
      expect(remoteCommitUrl("git@work-gitlab:group/project.git", sha, configured)).toBe(
        `${projectUrl}/-/commit/${sha}`,
      );
    },
  );

  it("設定に含まれるパス文字をURLとしてエスケープする", () => {
    expect(
      remoteCommitUrl(
        "git@work-gitlab:group/project.git",
        sha,
        "https://gitlab.example.invalid/部門/開発",
      ),
    ).toBe(`https://gitlab.example.invalid/%E9%83%A8%E9%96%80/%E9%96%8B%E7%99%BA/-/commit/${sha}`);
  });

  it.each([
    "https://user:secret@gitlab.example.invalid/group/project.git",
    "ssh://git:secret@gitlab.example.invalid/group/project.git",
    "https://gitlab.example.invalid/group/project.git?token=secret",
    "https://gitlab.example.invalid/group/project.git#fragment",
    "http://gitlab.example.invalid/group/project.git",
    "file:///group/project.git",
    "javascript:alert(1)",
  ])("安全でないremoteはリンクにしない: %s", (remote) => {
    expect(remoteCommitUrl(remote, sha, projectUrl)).toBeUndefined();
  });

  it.each([
    "",
    "gitlab.example.invalid/group/project",
    "https://gitlab.example.invalid",
    "https://gitlab.example.invalid/group",
    "http://gitlab.example.invalid/group/project",
    "javascript:alert(1)",
    "https://user:secret@gitlab.example.invalid/group/project",
    "https://gitlab.example.invalid/group/project?token=secret",
    "https://gitlab.example.invalid/group/project#fragment",
    "https://gitlab.example.invalid/group/project?",
    "https://gitlab.example.invalid/group/project#",
    "https://gitlab.example.invalid/../group/project",
    "https://gitlab.example.invalid/%2e%2e/group/project",
    "https://gitlab.example.invalid/group//project",
    "https://gitlab.example.invalid/group/.git",
    "https://gitlab.example.invalid/group/%2fproject",
    "https://gitlab.example.invalid/group/%5cproject",
    "https://gitlab.example.invalid/group/%0aproject",
    "https://gitlab.example.invalid/group/%broken",
    "https://gitlab.example.invalid/group/\\project",
    "https://gitlab.example.invalid/group/\nproject",
    null,
    42,
    {},
  ])("不正な設定を無視して認証情報を漏らさない: %j", (configured) => {
    expect(remoteCommitUrl("git@work-gitlab:group/project.git", sha, configured)).toBeUndefined();
  });

  it("設定なしでは未知のホストを推測しない", () => {
    expect(remoteCommitUrl("git@gitlab.example.invalid:group/project.git", sha)).toBeUndefined();
  });

  it.each(["bad", "a".repeat(39), "../commit", "a".repeat(40) + "?secret"])(
    "不正なコミットIDを拒否する: %s",
    (revision) => {
      expect(
        remoteCommitUrl("git@work-gitlab:group/project.git", revision, projectUrl),
      ).toBeUndefined();
    },
  );

  it.each([
    ["git@github.com:group/project.git", "https://github.com/group/project/commit/"],
    ["git@gitlab.com:group/project.git", "https://gitlab.com/group/project/-/commit/"],
    ["git@gitlab.com:/group/project.git", "https://gitlab.com/group/project/-/commit/"],
    ["git@bitbucket.org:group/project.git", "https://bitbucket.org/group/project/commits/"],
  ])("既存プロバイダー %s は設定の有無に影響されない", (remote, expected) => {
    expect(remoteCommitUrl(remote, sha, projectUrl)).toBe(expected + sha);
    expect(remoteCommitUrl(remote, sha, "not a URL")).toBe(expected + sha);
  });
});
