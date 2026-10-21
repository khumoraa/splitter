import test from "node:test";
import assert from "node:assert/strict";
import { CURRENCIES, normalizeCurrency, FALLBACK_CURRENCY } from "./currencies.ts";

test("codes are unique upper-case ISO-like codes and the fallback is offered", () => {
  const codes = CURRENCIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[A-Z]{3}$/);
  assert.ok(codes.includes(FALLBACK_CURRENCY));
});

test("normalizeCurrency accepts known codes in any case and falls back otherwise", () => {
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency(" eur "), "EUR");
  for (const v of ["", "XXX", "UNKNOWN", null, undefined, 5]) assert.equal(normalizeCurrency(v), FALLBACK_CURRENCY);
});

import fs from "node:fs";

test("every offered currency has a name in all three languages, and the legal texts exist (they are looked up dynamically)", () => {
  for (const lang of ["en", "ja", "uz"]) {
    const j = JSON.parse(fs.readFileSync(new URL(`./locales/${lang}.json`, import.meta.url), "utf8"));
    for (const c of CURRENCIES) assert.ok(j.currencies?.[c.code]?.length > 1, `${lang}: currencies.${c.code}`);
    for (const doc of ["privacy", "terms"]) {
      assert.ok(j.legal?.[doc]?.title && j.legal[doc].body.split("\n\n").length >= 4, `${lang}: legal.${doc}`);
    }
  }
});
