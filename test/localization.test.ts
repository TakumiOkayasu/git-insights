import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { labelKeys } from "../src/labels";
import { decodeAvatar } from "../src/avatar";
it("has a Japanese translation for every webview label", () => {
  const translations = JSON.parse(
    readFileSync(new URL("../l10n/bundle.l10n.ja.json", import.meta.url), "utf8"),
  );
  for (const key of labelKeys) expect(translations[key], key).toBeTruthy();
});
it("has both English and Japanese manifest translations", () => {
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  for (const locale of ["", "ja."]) {
    const translations = JSON.parse(
      readFileSync(new URL(`../package.nls.${locale}json`, import.meta.url), "utf8"),
    );
    for (const match of pkg.matchAll(/%([^%]+)%/g))
      expect(translations[match[1]], match[1]).toBeTruthy();
  }
});
it("decodes bounded raster data and rejects URLs, SVG and malformed payloads", () => {
  expect(decodeAvatar("data:image/png;base64,AQID")?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  for (const value of [
    "https://example.invalid/a.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,AQID",
    "data:image/png;base64,AQID#evil",
    "data:image/png;base64,%%%%",
    42,
    null,
    "data:image/png;base64," + "A".repeat(180000),
  ])
    expect(decodeAvatar(value)).toBeUndefined();
});

it("has Japanese translations for blame hover labels", () => {
  const translations = JSON.parse(
    readFileSync(new URL("../l10n/bundle.l10n.ja.json", import.meta.url), "utf8"),
  );
  for (const key of [
    "Settings",
    "{0} files changed",
    "{0} insertions (+)",
    "{0} deletions (-)",
    "{0} binary files",
    "Change statistics unavailable.",
    "Open in {0}",
  ])
    expect(translations[key], key).toBeTruthy();
});
