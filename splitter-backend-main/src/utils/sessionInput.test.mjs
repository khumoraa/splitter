import test from "node:test";
import assert from "node:assert/strict";
import { validateBillInput, parseMoneyField, MAX_ITEMS } from "./sessionInput.ts";

const P = [{ uniqueId: "a" }];
const ok = { id: "1", name: "Tea", quantity: 1, price: 2.5 };

test("valid bill", () => {
  assert.equal(validateBillInput([ok, { ...ok, id: "2", kind: "discount", price: -1 }], P), null);
});
test("participants and item counts", () => {
  assert.equal(validateBillInput([ok], []).code, "INVALID_PARTICIPANTS");
  assert.equal(validateBillInput([], P).code, "INVALID_ITEMS");
  assert.equal(validateBillInput(Array(MAX_ITEMS + 1).fill(ok), P).code, "INVALID_ITEMS");
  assert.equal(validateBillInput(Array(MAX_ITEMS).fill(ok), P), null);
});
test("item fields", () => {
  assert.deepEqual(validateBillInput([{ ...ok, name: "  " }], P), { code: "INVALID_ITEMS", field: "name", index: 0 });
  assert.equal(validateBillInput([{ ...ok, name: "x".repeat(201) }], P).field, "name");
  assert.equal(validateBillInput([ok, { ...ok, quantity: 0 }], P).index, 1);
  assert.equal(validateBillInput([{ ...ok, quantity: 1.5 }], P).field, "quantity");
  assert.equal(validateBillInput([{ ...ok, price: -1 }], P).field, "price");
  assert.equal(validateBillInput([{ ...ok, price: "abc" }], P).field, "price");
  assert.equal(validateBillInput([{ ...ok, price: 0 }], P), null);
  assert.equal(validateBillInput([null], P).field, "item");
});
test("parseMoneyField", () => {
  assert.equal(parseMoneyField(undefined), 0);
  assert.equal(parseMoneyField("12.5"), 12.5);
  assert.equal(parseMoneyField(-1), null);
  assert.equal(parseMoneyField("x"), null);
  assert.equal(parseMoneyField(1e12), null);
});
