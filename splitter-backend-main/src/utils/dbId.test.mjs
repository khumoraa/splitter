import test from "node:test";
import assert from "node:assert/strict";
import { isDbId, hasNulChar, MAX_DB_ID } from "./dbId.ts";

test("database ids are 1..2^31-1 integers", () => {
  assert.equal(isDbId(1), true);
  assert.equal(isDbId(MAX_DB_ID), true);
  for (const v of [0, -1, 1.5, MAX_DB_ID + 1, 99999999999999, NaN, "5", null, undefined, Infinity]) assert.equal(isDbId(v), false, String(v));
});
test("NUL bytes are found anywhere in a body", () => {
  assert.equal(hasNulChar("a\u0000b"), true);
  assert.equal(hasNulChar({ a: { b: ["x", "y\u0000"] } }), true);
  assert.equal(hasNulChar({ a: "fine", n: 5, z: null }), false);
  assert.equal(hasNulChar(undefined), false);
});
