import test from "node:test";
import assert from "node:assert/strict";
import { buildFriendIdLink, parseInviteFromScan } from "./invite.ts";

test("my-QR link round-trips and is parsed as a friend-id invite", () => {
  const link = buildFriendIdLink("#1234");
  assert.equal(link, "receipt-splitter://friend?uid=%231234");
  assert.deepEqual(parseInviteFromScan(link), { kind: "friend-id", token: "#1234" });
});

test("only well-formed ids are accepted (no injection through the QR)", () => {
  for (const bad of ["receipt-splitter://friend?uid=%23123", "receipt-splitter://friend?uid=abc", "receipt-splitter://friend?uid=%231234%00", "receipt-splitter://friend?uid=%23%31%32%33%34x", "receipt-splitter://friend", "receipt-splitter://group?uid=%231234"]) {
    assert.equal(parseInviteFromScan(bad), null, bad);
  }
});

test("existing token invites still work", () => {
  assert.deepEqual(parseInviteFromScan("http://10.0.0.5:3001/friends/join?token=abc"), { kind: "friend", token: "abc" });
  assert.deepEqual(parseInviteFromScan("https://x.io/groups/join?token=t1"), { kind: "group", token: "t1" });
  assert.equal(parseInviteFromScan("https://x.io/other?token=t1"), null);
  assert.equal(parseInviteFromScan("hello"), null);
});
