import test from "node:test";
import assert from "node:assert/strict";
import { anonymizePayload, replaceUniqueId } from "./anonymize.ts";

const payload = {
  sessionName: "Dinner",
  payer: { uniqueId: "#1111", username: "Alice" },
  totals: {
    byParticipant: [
      { uniqueId: "#1111", username: "Alice", amountOwed: 5, participantId: "#1111", total: 5, avatarUrl: "http://x/a.jpg" },
      { uniqueId: "#2222", username: "Bob", amountOwed: 7, participantId: "#2222", total: 7 },
    ],
    byItem: [{ itemId: "1", name: "Pizza #1111", total: 12 }],
  },
  allocations: [{ itemId: "1", participantId: "#1111", shareAmount: 5 }, { itemId: "1", participantId: "#2222", shareAmount: 7 }],
};

test("replaces the id and name of the deleted person everywhere, leaves the others alone", () => {
  const out = anonymizePayload(payload, "#1111", "#deleted-abc", "Deleted user");
  const text = JSON.stringify(out);
  assert.ok(!text.includes('"#1111"'), text);
  assert.ok(!text.includes("Alice"), text);
  assert.equal(out.payer.uniqueId, "#deleted-abc");
  assert.equal(out.payer.username, "Deleted user");
  assert.equal(out.totals.byParticipant[0].avatarUrl, null);
  assert.equal(out.allocations[0].participantId, "#deleted-abc");
  assert.deepEqual(out.totals.byParticipant[1], payload.totals.byParticipant[1]);
  assert.equal(out.totals.byItem[0].name, "Pizza #1111"); // free text is not a person reference
});

test("does not mutate the input and handles null/empty values", () => {
  const copy = JSON.parse(JSON.stringify(payload));
  anonymizePayload(payload, "#1111", "#d", "X");
  assert.deepEqual(payload, copy);
  assert.equal(anonymizePayload(null, "#1", "#2", "X"), null);
  assert.deepEqual(anonymizePayload({}, "#1", "#2", "X"), {});
});

test("replaceUniqueId keeps the list unique and sorted", () => {
  assert.deepEqual(replaceUniqueId(["#2222", "#1111"], "#1111", "#deleted-abc"), ["#2222", "#deleted-abc"]);
  assert.deepEqual(replaceUniqueId(["#1", "#2"], "#9", "#x"), ["#1", "#2"]);
});
