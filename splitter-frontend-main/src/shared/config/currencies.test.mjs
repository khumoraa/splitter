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
