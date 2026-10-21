import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, toMinorUnits, fractionDigits, normalizeItem, reconcile } from "./scanMath.ts";

test("parseAmount: separators and symbols", () => {
  assert.equal(parseAmount("1 234,50"), 1234.5);
  assert.equal(parseAmount("1.234,50"), 1234.5);
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("12.99"), 12.99);
  assert.equal(parseAmount("$12.99"), 12.99);
  assert.equal(parseAmount("UZS 45 000"), 45000);
  assert.equal(parseAmount("45 000"), 45000);
  assert.equal(parseAmount("1,234"), 1234);
  assert.equal(parseAmount("1.234"), 1234);
  assert.equal(parseAmount("0.125"), 0.125);
  assert.equal(parseAmount("1,234,567"), 1234567);
  assert.equal(parseAmount("-5,00"), -5);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(7.5), 7.5);
  assert.equal(parseAmount(NaN), null);
});

test("parseAmount: zero-decimal currencies never have a decimal mark", () => {
  assert.equal(parseAmount("1,500", "JPY"), 1500);
  assert.equal(parseAmount("12.500", "UZS"), 12500);
  assert.equal(parseAmount("12.50", "USD"), 12.5);
});

test("toMinorUnits by currency", () => {
  assert.equal(fractionDigits("JPY"), 0);
  assert.equal(fractionDigits("UZS"), 0);
  assert.equal(fractionDigits("USD"), 2);
  assert.equal(fractionDigits(null), 2);
  assert.equal(toMinorUnits(12.99, "USD"), 1299);
  assert.equal(toMinorUnits(1.005, "USD"), 101);
  assert.equal(toMinorUnits(0.1 * 3, "USD"), 30);
  assert.equal(toMinorUnits(1500, "JPY"), 1500);
  assert.equal(toMinorUnits(45000, "UZS"), 45000);
  assert.throws(() => toMinorUnits(NaN, "USD"));
});

test("normalizeItem fills missing fields and flags disagreement", () => {
  const a = normalizeItem({ name: " Latte ", quantity: 2, unitPrice: 3.5 }, "USD");
  assert.deepEqual(a.item, { name: "Latte", quantity: 2, unitMinor: 350, totalMinor: 700, confidence: 0.8 });
  assert.equal(a.lineMismatch, false);
  const b = normalizeItem({ name: "x", quantity: 3, lineTotal: 10 }, "USD");
  assert.equal(b.item.unitMinor, 333);
  assert.equal(b.item.totalMinor, 1000);
  const c = normalizeItem({ name: "x", quantity: 2, unitPrice: 3, lineTotal: 7, confidence: 0.9 }, "USD");
  assert.equal(c.lineMismatch, true);
  assert.equal(c.item.totalMinor, 700); // printed total wins, never silently changed
  assert.equal(c.item.confidence, 0.5);
  const d = normalizeItem({ name: "x" }, "USD");
  assert.equal(d.lineMismatch, true);
  assert.equal(normalizeItem({ name: "x", quantity: 0, unitPrice: 1 }, "USD").item.quantity, 1);
  assert.equal(normalizeItem({ name: "y", unitPrice: 100, lineTotal: 100 }, "JPY").item.totalMinor, 100);
});

const it = (totalMinor) => ({ name: "i", quantity: 1, unitMinor: totalMinor, totalMinor, confidence: 1 });

test("reconcile: matching total gives no warnings", () => {
  // 10.00 + 5.00 + tax 1.50 + tip 2.00 - discount 1.00 = 17.50
  const w = reconcile({ items: [it(1000), it(500)], taxMinor: 150, tipMinor: 200, discountMinor: 100, totalMinor: 1750 });
  assert.deepEqual(w, []);
});

test("reconcile: mismatch reports the difference and never adjusts", () => {
  const w = reconcile({ items: [it(1000), it(500)], taxMinor: 0, tipMinor: 0, discountMinor: 0, totalMinor: 1600 });
  assert.deepEqual(w, [{ code: "TOTAL_MISMATCH", expectedMinor: 1600, computedMinor: 1500, differenceMinor: 100 }]);
  const neg = reconcile({ items: [it(1000)], taxMinor: 0, tipMinor: 0, discountMinor: 0, totalMinor: 900 });
  assert.equal(neg[0].differenceMinor, -100);
});

test("reconcile: no total, no items, line mismatch", () => {
  assert.deepEqual(reconcile({ items: [it(100)], taxMinor: 0, tipMinor: 0, discountMinor: 0, totalMinor: null }), [{ code: "NO_TOTAL" }]);
  const w = reconcile({ items: [], taxMinor: 0, tipMinor: 0, discountMinor: 0, totalMinor: 0, lineMismatchIndexes: [0] });
  assert.deepEqual(w.map((x) => x.code), ["NO_ITEMS", "LINE_MISMATCH"]);
});

test("reconcile: JPY whole units", () => {
  assert.deepEqual(reconcile({ items: [it(1200), it(800)], taxMinor: 200, tipMinor: 0, discountMinor: 0, totalMinor: 2200 }), []);
});
