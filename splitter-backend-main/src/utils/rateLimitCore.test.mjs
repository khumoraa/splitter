import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter } from "./rateLimitCore.ts";

test("allows `max` hits per window, then blocks with a retry hint", () => {
  const l = new SlidingWindowLimiter(1000, 3);
  assert.equal(l.hit("u1", 0).allowed, true);
  assert.equal(l.hit("u1", 100).allowed, true);
  const third = l.hit("u1", 200);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
  const blocked = l.hit("u1", 300);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 700); // first hit leaves the window at t=1000
});

test("keys are independent and the window slides", () => {
  const l = new SlidingWindowLimiter(1000, 1);
  assert.equal(l.hit("a", 0).allowed, true);
  assert.equal(l.hit("b", 10).allowed, true);
  assert.equal(l.hit("a", 500).allowed, false);
  assert.equal(l.hit("a", 1001).allowed, true);
});

test("blocked attempts do not extend the block, and sweep() frees memory", () => {
  const l = new SlidingWindowLimiter(1000, 1);
  l.hit("a", 0);
  for (let t = 1; t < 900; t += 100) assert.equal(l.hit("a", t).allowed, false);
  assert.equal(l.hit("a", 1000).allowed, true);
  l.sweep(10_000);
  assert.equal(l.hit("a", 10_001).allowed, true);
});
