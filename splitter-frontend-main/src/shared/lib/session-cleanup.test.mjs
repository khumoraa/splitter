import test from "node:test";
import assert from "node:assert/strict";
import { onSessionCleanup, runSessionCleanup } from "./session-cleanup.ts";

test("all registered resets run on cleanup, a failing one does not stop the rest", () => {
  const calls = [];
  const off1 = onSessionCleanup(() => calls.push("a"));
  onSessionCleanup(() => { throw new Error("boom"); });
  const off3 = onSessionCleanup(() => calls.push("c"));
  assert.equal(runSessionCleanup(), 1);
  assert.deepEqual(calls, ["a", "c"]);
  off1(); off3();
  calls.length = 0;
  runSessionCleanup();
  assert.deepEqual(calls, []);
});
