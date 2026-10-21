import test from "node:test";
import assert from "node:assert/strict";
import { computeQuota, readLimits, DAY_MS, MONTH_MS } from "./scanQuota.ts";

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const L = { daily: 3, monthly: 10 };

test("within the limit", () => {
  const q = computeQuota([NOW - 1000, NOW - 2000], NOW, L);
  assert.equal(q.remaining, 1);
  assert.equal(q.limit, 3);
  assert.equal(q.resetAt, null);
  assert.equal(q.daily.used, 2);
});

test("boundary: exactly at the limit is blocked and resets when the oldest call leaves", () => {
  const oldest = NOW - 3 * 60 * 60 * 1000;
  const q = computeQuota([oldest, NOW - 2000, NOW - 1000], NOW, L);
  assert.equal(q.remaining, 0);
  assert.equal(q.resetAt, new Date(oldest + DAY_MS).toISOString());
});

test("exceeded counts only calls inside the window", () => {
  const q = computeQuota([NOW - DAY_MS - 1, NOW - DAY_MS - 5, NOW - 10], NOW, L);
  assert.equal(q.daily.used, 1);
  assert.equal(q.remaining, 2);
});

test("a call exactly one day old no longer counts (reset)", () => {
  const q = computeQuota([NOW - DAY_MS, NOW - 10, NOW - 20], NOW, L);
  assert.equal(q.daily.used, 2);
  assert.equal(q.remaining, 1);
});

test("monthly limit can block while the daily one is free", () => {
  const stamps = Array.from({ length: 10 }, (_, i) => NOW - (i + 2) * DAY_MS);
  const q = computeQuota(stamps, NOW, L);
  assert.equal(q.daily.remaining, 3);
  assert.equal(q.monthly.remaining, 0);
  assert.equal(q.remaining, 0);
  assert.equal(q.limit, 10);
  assert.equal(q.resetAt, new Date(stamps[9] + MONTH_MS).toISOString());
});

test("both exhausted: reset is the later of the two", () => {
  const stamps = [NOW - 1000, NOW - 2000, NOW - 3000, ...Array.from({ length: 7 }, (_, i) => NOW - (i + 2) * DAY_MS)];
  const q = computeQuota(stamps, NOW, L);
  assert.equal(q.remaining, 0);
  const monthlyFree = Math.min(...stamps) + MONTH_MS;
  assert.equal(q.resetAt, new Date(monthlyFree).toISOString());
});

test("zero limit never throws", () => {
  const q = computeQuota([], NOW, { daily: 0, monthly: 0 });
  assert.equal(q.remaining, 0);
  assert.equal(q.resetAt, null);
});

test("readLimits: defaults and overrides", () => {
  assert.deepEqual(readLimits({}), { daily: 10, monthly: 100 });
  assert.deepEqual(readLimits({ SCAN_LIMIT_DAILY: "5", SCAN_LIMIT_MONTHLY: "40" }), { daily: 5, monthly: 40 });
  assert.deepEqual(readLimits({ SCAN_LIMIT_DAILY: "abc", SCAN_LIMIT_MONTHLY: "-1" }), { daily: 10, monthly: 100 });
});
