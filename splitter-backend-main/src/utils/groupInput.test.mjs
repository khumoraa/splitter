import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGroupName, readUniqueIds, MAX_GROUP_NAME } from "./groupInput.ts";

test("group name", () => {
  assert.equal(normalizeGroupName("  Trip   to  Kyoto "), "Trip to Kyoto");
  assert.equal(normalizeGroupName(""), null);
  assert.equal(normalizeGroupName("   "), null);
  assert.equal(normalizeGroupName(5), null);
  assert.equal(normalizeGroupName("x".repeat(MAX_GROUP_NAME)), "x".repeat(MAX_GROUP_NAME));
  assert.equal(normalizeGroupName("x".repeat(MAX_GROUP_NAME + 1)), null);
  assert.equal(normalizeGroupName("日本旅行"), "日本旅行");
});
test("unique id list", () => {
  assert.deepEqual(readUniqueIds({ uniqueId: " #1234 " }), ["#1234"]);
  assert.deepEqual(readUniqueIds({ uniqueIds: ["#1", "#2", "#1"] }), ["#1", "#2"]);
  assert.equal(readUniqueIds({}), null);
  assert.equal(readUniqueIds({ uniqueIds: [] }), null);
  assert.equal(readUniqueIds({ uniqueIds: [1] }), null);
  assert.equal(readUniqueIds({ uniqueIds: Array.from({ length: 21 }, (_, i) => "#" + i) }), null);
});
