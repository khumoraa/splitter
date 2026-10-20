import test from "node:test";
import assert from "node:assert/strict";
import { toMinor, fromMinor, splitMinor } from "./money.ts";

const sum = (a) => a.reduce((x, y) => x + y, 0);

test("toMinor avoids float drift", () => {
  assert.equal(toMinor(0.1 * 3), 30);
  assert.equal(toMinor(1.005), 101);
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(33.33 * 3), 9999);
  assert.equal(toMinor(0), 0);
  assert.equal(toMinor(-2.5), -250);
  assert.throws(() => toMinor(NaN));
  assert.throws(() => toMinor(Infinity));
});

test("fromMinor gives clean decimals", () => {
  assert.equal(fromMinor(1999), 19.99);
  assert.equal(fromMinor(30), 0.3);
  assert.equal(fromMinor(-250), -2.5);
});

test("splitMinor always sums to the total", () => {
  const cases = [[100, 3], [1, 3], [1000, 3], [9999, 7], [100, 7], [1999, 6], [0, 4], [5, 10], [7, 1]];
  for (const [total, n] of cases) {
    for (let offset = 0; offset < n; offset++) {
      const shares = splitMinor(total, n, offset);
      assert.equal(shares.length, n);
      assert.equal(sum(shares), total, `total=${total} n=${n} offset=${offset}`);
      assert.ok(Math.max(...shares) - Math.min(...shares) <= 1, "shares differ by at most one cent");
    }
  }
});

test("splitMinor spreads leftovers and rotates with offset", () => {
  assert.deepEqual(splitMinor(100, 7, 0), [15, 15, 14, 14, 14, 14, 14]);
  assert.deepEqual(splitMinor(100, 7, 6), [15, 14, 14, 14, 14, 14, 15]);
  assert.deepEqual(splitMinor(1, 3, 1), [0, 1, 0]);
  assert.deepEqual(splitMinor(1000, 3, 0), [334, 333, 333]);
});

test("splitMinor handles negative totals (discounts) and negative offsets", () => {
  const shares = splitMinor(-100, 3, 0);
  assert.equal(sum(shares), -100);
  assert.deepEqual(shares, [-34, -33, -33]);
  assert.equal(sum(splitMinor(100, 3, -1)), 100);
});

test("splitMinor validates input", () => {
  assert.throws(() => splitMinor(10.5, 2));
  assert.throws(() => splitMinor(10, 0));
  assert.throws(() => splitMinor(10, 1.5));
});

import { formatAmount, currencyFractionDigits } from "./money.ts";

test("formatAmount keeps cents for decimal currencies and drops them for zero-decimal ones", () => {
  assert.equal(formatAmount(10.5, "USD"), "10.50");
  assert.equal(formatAmount(1234.5, "usd"), "1,234.50");
  assert.equal(formatAmount(0.3, "EUR"), "0.30");
  assert.equal(formatAmount(89000, "UZS"), "89,000");
  assert.equal(formatAmount(1500, "JPY"), "1,500");
  assert.equal(formatAmount(NaN, "USD"), "0.00");
  assert.equal(currencyFractionDigits("UNKNOWN"), 2);
});
