import test from "node:test";
import assert from "node:assert/strict";
import { onUnauthorized, emitUnauthorized, resetUnauthorizedCooldown, UNAUTHORIZED_COOLDOWN_MS } from "./auth-events.ts";

test("a burst of 401s notifies listeners once", () => {
  resetUnauthorizedCooldown();
  let calls = 0;
  const off = onUnauthorized(() => { calls++; });
  emitUnauthorized(1000);
  emitUnauthorized(1001);
  emitUnauthorized(1000 + UNAUTHORIZED_COOLDOWN_MS - 1);
  assert.equal(calls, 1);
  off();
});

test("a later 401 (after the cooldown) notifies again", () => {
  resetUnauthorizedCooldown();
  let calls = 0;
  const off = onUnauthorized(() => { calls++; });
  emitUnauthorized(5000);
  emitUnauthorized(5000 + UNAUTHORIZED_COOLDOWN_MS);
  assert.equal(calls, 2);
  off();
});

test("resetUnauthorizedCooldown lets the next 401 through immediately (e.g. right after sign-in)", () => {
  resetUnauthorizedCooldown();
  let calls = 0;
  const off = onUnauthorized(() => { calls++; });
  emitUnauthorized(9000);
  resetUnauthorizedCooldown();
  emitUnauthorized(9001);
  assert.equal(calls, 2);
  off();
});
