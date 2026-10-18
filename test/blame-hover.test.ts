import { expect, it, vi } from "vitest";
import { blameHover } from "../src/blame-hover";
import { defaultAvatarSvg, defaultAvatarUri } from "../src/default-avatar";
import { decodeAvatar } from "../src/avatar";

vi.mock("vscode", () => ({
  MarkdownString: class {
    value = "";
    appendMarkdown(text: string) {
      this.value += text;
      return this;
    }
    appendText(text: string) {
      this.value += text;
      return this;
    }
  },
  env: { language: "ja" },
  l10n: { t: (text: string) => text },
}));

const commit = {
  sha: "a".repeat(40),
  parents: [],
  author: "著者",
  email: "author@example.invalid",
  date: "2026-10-18T00:00:00Z",
  subject: "変更内容",
  body: "",
};

it.each([undefined, "", "https://example.invalid/tracker", "data:image/svg+xml;base64,AQID"])(
  "ホバーで未設定・不正なアバターを固定SVGへ置き換える: %s",
  (avatar) => {
    const hover = blameHover(commit, { avatar }, 1);
    expect(hover.value).toContain(`<img src="${defaultAvatarUri}" width="20" height="20" alt=""`);
    expect(hover.value).toContain(commit.author);
    expect(hover.value).not.toContain("https://example.invalid/tracker");
    expect(hover.value).not.toContain("data:image/svg+xml;base64,AQID");
  },
);

it("設定済みのラスタ画像はホバーでも維持する", () => {
  const avatar = "data:image/png;base64,AQID";
  const hover = blameHover(commit, { avatar }, 1);
  expect(hover.value).toContain(`<img src="${avatar}"`);
  expect(hover.value).not.toContain(defaultAvatarUri);
});

it("同梱SVGは受信画像の許可対象を増やさない", () => {
  expect(atob(defaultAvatarUri.split(",")[1])).toBe(defaultAvatarSvg);
  expect(defaultAvatarSvg).not.toMatch(/<(script|foreignObject)|\bon\w+=|\bhref=/i);
  expect(decodeAvatar(defaultAvatarUri)).toBeUndefined();
});

it("未コミット変更のホバーには著者アバターを追加しない", () => {
  expect(blameHover(undefined, {}, 1).value).not.toContain("<img");
});
