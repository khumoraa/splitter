import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDraft, computeTotals, reconcileDraft, balanceDraft, validateDraft, draftFromScan, toSplitItems,
  parseMinorInput, formatMinorInput, parsePercentInput, formatPercentInput, toMinorUnits, minorToMajor, formatMinor, resolveAdjustment, lineMinor,
  changeCurrency, isValidIsoDate, defaultReceiptName,
} from "./receipt-calc.ts";
import { splitMinor } from "../../../shared/lib/utils/money.ts";

let n = 0;
const id = () => `id${++n}`;
const item = (name, quantity, unitMinor, confidence = 1) => ({ id: id(), name, quantity, unitMinor, confidence });
const draftOf = (items, cur = "USD", extra = {}) => ({ ...emptyDraft(cur, "manual", 0), items, ...extra });
const amt = (amountMinor) => ({ mode: "amount", amountMinor, percentBp: 0 });
const pct = (percentBp) => ({ mode: "percent", amountMinor: 0, percentBp });

test("totals: subtotal + tax + tip - discount in minor units", () => {
  const d = draftOf([item("Latte", 2, 350), item("Cake", 1, 525)], "USD", { tax: amt(140), tip: amt(150), discount: amt(100) });
  assert.deepEqual(computeTotals(d), { subtotal: 1225, tax: 140, tip: 150, discount: 100, total: 1415 });
});

test("percent adjustments are rounded once, on the subtotal", () => {
  const d = draftOf([item("A", 1, 1000)], "USD", { tax: pct(1000), tip: pct(1429), discount: pct(500) });
  const t = computeTotals(d);
  assert.equal(t.tax, 100); // 10%
  assert.equal(t.tip, 143); // 14.29% of 10.00 = 1.429 -> 1.43
  assert.equal(t.discount, 50);
  assert.equal(t.total, 1000 + 100 + 143 - 50);
  assert.equal(resolveAdjustment(pct(333), 100), 3); // 3.33% of 1.00 = 0.0333 -> 0.03
});

test("no float drift: 0.1 + 0.2 style sums stay exact", () => {
  const d = draftOf([item("a", 3, toMinorUnits(0.1, "USD")), item("b", 1, toMinorUnits(0.2, "USD"))]);
  assert.equal(computeTotals(d).total, 50);
  assert.equal(toMinorUnits(1.005, "USD"), 101);
});

test("100 split three ways and 1 split seven ways always sum exactly", () => {
  assert.deepEqual(splitMinor(10000, 3), [3334, 3333, 3333]);
  assert.equal(splitMinor(10000, 3).reduce((a, b) => a + b, 0), 10000);
  assert.equal(splitMinor(100, 7).reduce((a, b) => a + b, 0), 100);
  assert.equal(splitMinor(-1000, 3).reduce((a, b) => a + b, 0), -1000);
});

test("JPY / UZS have no fractional units", () => {
  const d = draftOf([item("Ramen", 2, 900), item("Tea", 1, 300)], "JPY", { tax: pct(1000) });
  const t = computeTotals(d);
  assert.deepEqual(t, { subtotal: 2100, tax: 210, tip: 0, discount: 0, total: 2310 });
  assert.equal(toMinorUnits(1500, "JPY"), 1500);
  assert.equal(minorToMajor(1500, "JPY"), 1500);
  assert.equal(minorToMajor(1299, "USD"), 12.99);
  assert.equal(formatMinorInput(45000, "UZS"), "45000");
  assert.equal(parseMinorInput("45 000", "UZS"), 45000);
});

test("price input parsing and formatting", () => {
  assert.equal(parseMinorInput("12,5", "USD"), 1250);
  assert.equal(parseMinorInput("12.99", "USD"), 1299);
  assert.equal(parseMinorInput("0", "USD"), 0);
  assert.equal(parseMinorInput("", "USD"), null);
  assert.equal(parseMinorInput("abc", "USD"), null);
  assert.equal(parseMinorInput("-5", "USD"), null);
  assert.equal(parseMinorInput("1.2.3", "USD"), null);
  assert.equal(formatMinorInput(1250, "USD"), "12.5");
  assert.equal(formatMinorInput(1205, "USD"), "12.05");
  assert.equal(formatMinorInput(1200, "USD"), "12");
  assert.equal(parsePercentInput("10,5"), 1050);
  assert.equal(parsePercentInput("101"), null);
  assert.equal(parsePercentInput("x"), null);
  assert.equal(formatPercentInput(1050), "10.5");
  assert.equal(formatPercentInput(1000), "10");
});

test("formatMinor uses the currency's fraction digits", () => {
  assert.match(formatMinor(1250, "USD", "en-US"), /12\.50/);
  assert.match(formatMinor(1500, "JPY", "en-US"), /1,500/);
  assert.ok(!/\./.test(formatMinor(45000, "UZS", "en-US")));
});

test("reconciliation reports the difference and does not change the draft", () => {
  const d = draftOf([item("A", 1, 1000), item("B", 1, 500)], "USD", { receiptTotalMinor: 1600 });
  assert.deepEqual(reconcileDraft(d), { state: "mismatch", differenceMinor: 100 });
  assert.deepEqual(reconcileDraft({ ...d, receiptTotalMinor: 1500 }), { state: "match" });
  assert.deepEqual(reconcileDraft({ ...d, receiptTotalMinor: null }), { state: "none" });
});

test("balanceDraft: missing money becomes an explicit line, excess becomes a discount", () => {
  const d = draftOf([item("A", 1, 1000)], "USD", { receiptTotalMinor: 1250 });
  const up = balanceDraft(d, "Other", id);
  assert.equal(up.items.length, 2);
  assert.equal(up.items[1].unitMinor, 250);
  assert.equal(reconcileDraft(up).state, "match");
  const down = balanceDraft({ ...d, receiptTotalMinor: 900 }, "Other", id);
  assert.equal(down.discount.amountMinor, 100);
  assert.equal(reconcileDraft(down).state, "match");
  const matching = { ...d, receiptTotalMinor: 1000 };
  assert.equal(balanceDraft(matching, "Other", id), matching, "nothing to balance: same draft back");
});

test("validateDraft", () => {
  assert.deepEqual(validateDraft(draftOf([])), [{ field: "items" }]);
  const bad = draftOf([{ id: "x", name: " ", quantity: 0, unitMinor: -1, confidence: 1 }]);
  const fields = validateDraft(bad).map((i) => i.field).sort();
  assert.deepEqual(fields, ["name", "price", "quantity", "total"].sort());
  assert.deepEqual(validateDraft(draftOf([item("ok", 2, 100)])), []);
  assert.equal(validateDraft(draftOf([item("free", 1, 0)])).some((i) => i.field === "total"), true);
});

test("draftFromScan: server minor units in, fractional quantities folded into one line", () => {
  const dto = {
    merchant: "Cafe", date: "2026-10-20", currency: null,
    items: [
      { name: "Latte", quantity: 2, unitMinor: 350, totalMinor: 700, confidence: 0.9 },
      { name: "Cheese", quantity: 0.35, unitMinor: 2000, totalMinor: 700, confidence: 0.5 },
    ],
    taxMinor: 140, tipMinor: 0, discountMinor: 50, totalMinor: 1490, warnings: [],
  };
  const d = draftFromScan(dto, "EUR", id, 5);
  assert.equal(d.currency, "EUR");
  assert.equal(d.source, "scan");
  assert.deepEqual(d.items.map((i) => [i.quantity, i.unitMinor, lineMinor(i)]), [[2, 350, 700], [1, 700, 700]]);
  assert.deepEqual(reconcileDraft(d), { state: "match" });
});

test("toSplitItems: tax/tip lines and a negative discount line for the existing split flow", () => {
  const d = draftOf([item("Latte", 2, 350)], "USD", { tax: amt(70), tip: pct(1000), discount: amt(100) });
  const out = toSplitItems(d, { tax: "Tax", tip: "Tip", discount: "Discount" }, id);
  assert.deepEqual(out.map((o) => [o.name, o.kind ?? null, o.totalPrice]), [["Latte", null, 7], ["Tax", "tax", 0.7], ["Tip", "tip", 0.7], ["Discount", "discount", -1]]);
  const none = toSplitItems(draftOf([item("a", 1, 100)]), { tax: "Tax", tip: "Tip", discount: "D" }, id);
  assert.equal(none.length, 1);
  const sum = Math.round(out.reduce((s, o) => s + o.totalPrice, 0) * 100);
  assert.equal(sum, computeTotals(d).total);
});

test("changeCurrency keeps major values across 2-digit and 0-digit currencies", () => {
  const d = draftOf([item("A", 2, 1250)], "USD", { tax: amt(100), receiptTotalMinor: 2600 });
  const eur = changeCurrency(d, "EUR");
  assert.equal(eur.items[0].unitMinor, 1250);
  const jpy = changeCurrency(d, "JPY");
  assert.equal(jpy.items[0].unitMinor, 13); // 12.50 -> 13 yen (rounded once, here)
  const back = changeCurrency({ ...draftOf([item("A", 1, 1500)], "JPY"), receiptTotalMinor: 1500 }, "USD");
  assert.equal(back.items[0].unitMinor, 150000);
  assert.equal(back.receiptTotalMinor, 150000);
  assert.equal(changeCurrency(d, "USD"), d);
});

test("dates and default names", () => {
  assert.equal(isValidIsoDate("2026-10-20"), true);
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("20-10-2026"), false);
  assert.equal(isValidIsoDate(""), false);
  assert.equal(defaultReceiptName(new Date(2026, 9, 5, 7, 3)), "2026-10-05 07:03");
});
