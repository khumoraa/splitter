import test from "node:test";
import assert from "node:assert/strict";
import { shouldConfirmLeave } from "./leave-guard.ts";

test("leaving asks only with unsaved input or work in progress", () => {
  assert.equal(shouldConfirmLeave({ dirty: false }), false);
  assert.equal(shouldConfirmLeave({ dirty: true }), true);
  assert.equal(shouldConfirmLeave({ dirty: false, busy: true }), true);
  assert.equal(shouldConfirmLeave({ dirty: true, saved: true }), false);
  assert.equal(shouldConfirmLeave({ dirty: true, allowOnce: true }), false);
  assert.equal(shouldConfirmLeave({ dirty: false, busy: true, saved: true }), false);
});
