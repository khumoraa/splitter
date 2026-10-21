import test from "node:test";
import assert from "node:assert/strict";
import { resolveLanguage, LANGUAGE_CODES, DEFAULT_LANGUAGE } from "./languages.ts";

test("resolveLanguage maps device locales to a supported language", () => {
  assert.equal(resolveLanguage("ja"), "ja");
  assert.equal(resolveLanguage("ja-JP"), "ja");
  assert.equal(resolveLanguage("UZ_uz"), "uz");
  assert.equal(resolveLanguage("en-GB"), "en");
});

test("unsupported, empty or missing locales fall back to the default", () => {
  for (const v of ["ru", "ru-RU", "", "  ", undefined, null, "xx-YY", "japanese"]) assert.equal(resolveLanguage(v), DEFAULT_LANGUAGE, String(v));
  assert.ok(LANGUAGE_CODES.includes(DEFAULT_LANGUAGE));
});
