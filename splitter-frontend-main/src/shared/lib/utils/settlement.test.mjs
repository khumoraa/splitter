import test from "node:test";
import assert from "node:assert/strict";
import { computeSettlements } from "./settlement.ts";

const alice = { uniqueId: "#1", username: "Alice" };
const sh = (uniqueId, username, amountOwed) => ({ uniqueId, username, amountOwed });

test("everyone except the payer owes the payer their share", () => {
  const t = computeSettlements([sh("#1", "Alice", 5.1), sh("#2", "Bob", 5.2), sh("#3", "Cy", 0.3)], alice);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => [x.from.username, x.to.username, x.amount]), [["Bob", "Alice", 5.2], ["Cy", "Alice", 0.3]]);
});

test("payer's own share creates no transfer; zero shares are skipped", () => {
  assert.deepEqual(computeSettlements([sh("#1", "Alice", 10)], alice), []);
  assert.deepEqual(computeSettlements([sh("#1", "Alice", 4), sh("#2", "Bob", 0)], alice), []);
});

test("a negative share flips the direction", () => {
  const [t] = computeSettlements([sh("#2", "Bob", -2.5)], alice);
  assert.equal(t.from.username, "Alice");
  assert.equal(t.to.username, "Bob");
  assert.equal(t.amount, 2.5);
});

test("payer who is not among the participants is still repaid in full", () => {
  const t = computeSettlements([sh("#2", "Bob", 6.67), sh("#3", "Cy", 6.67), sh("#4", "Di", 6.66)], alice);
  assert.equal(t.reduce((a, x) => a + x.amountMinor, 0), 2000);
});

test("cents are exact (0.1 + 0.2 style floats) and duplicates are merged", () => {
  const t = computeSettlements([sh("#2", "Bob", 0.1), sh("#2", "Bob", 0.2)], alice);
  assert.equal(t.length, 1);
  assert.equal(t[0].amountMinor, 30);
  assert.equal(t[0].amount, 0.3);
});

test("total conservation: transfers to payer equal total minus payer's share", () => {
  const shares = [sh("#1", "Alice", 33.34), sh("#2", "Bob", 33.33), sh("#3", "Cy", 33.33)];
  const t = computeSettlements(shares, alice);
  assert.equal(t.reduce((a, x) => a + x.amountMinor, 0), 10000 - 3334);
});
