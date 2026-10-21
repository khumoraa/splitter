import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchQuery, matchRank, rankCandidates, clampPaging } from "./searchQuery.ts";
import { decideFriendRequest, relationOf, COOLDOWN_MS } from "./friendship.ts";

test("parse: ids, usernames, noise", () => {
  assert.deepEqual(parseSearchQuery("#1234"), { kind: "id", uniqueId: "#1234", namePart: "" });
  assert.deepEqual(parseSearchQuery("  @#1234 "), { kind: "id", uniqueId: "#1234", namePart: "" });
  assert.deepEqual(parseSearchQuery("Alice#4821"), { kind: "id", uniqueId: "#4821", namePart: "Alice" });
  assert.deepEqual(parseSearchQuery("alice # 4821"), { kind: "id", uniqueId: "#4821", namePart: "alice" });
  assert.deepEqual(parseSearchQuery("1234"), { kind: "name", text: "1234", alsoId: "#1234" });
  assert.deepEqual(parseSearchQuery("@Alice"), { kind: "name", text: "Alice", alsoId: null });
  assert.deepEqual(parseSearchQuery("  Al   ice "), { kind: "name", text: "Al ice", alsoId: null });
  assert.equal(parseSearchQuery("a").kind, "short");
  assert.equal(parseSearchQuery("@").kind, "short");
  assert.equal(parseSearchQuery("#12").kind, "short");
  assert.equal(parseSearchQuery("123").kind, "name"); // 3 digits can still be a username
  assert.equal(parseSearchQuery("").kind, "empty");
  assert.equal(parseSearchQuery(undefined).kind, "empty");
  assert.equal(parseSearchQuery(["a"]).kind, "empty");
  assert.equal(parseSearchQuery("x".repeat(65)).kind, "invalid");
});

test("rank: exact, prefix, substring, case-insensitive, stable", () => {
  assert.equal(matchRank("Alice", "alice"), 0);
  assert.equal(matchRank("Alice B", "ali"), 1);
  assert.equal(matchRank("Malice", "ali"), 2);
  assert.equal(matchRank("Bob", "ali"), null);
  const items = [
    { id: 5, username: "Malice" }, { id: 3, username: "alice b" }, { id: 4, username: "Alice" },
    { id: 2, username: "alice a" }, { id: 1, username: "Bob" }, { id: 6, username: "Alice" },
  ];
  assert.deepEqual(rankCandidates(items, "alice").map((i) => i.id), [4, 6, 2, 3, 5]);
  assert.deepEqual(rankCandidates(items, "ali").map((i) => i.id), [4, 6, 2, 3, 5]);
});

test("paging is clamped", () => {
  assert.deepEqual(clampPaging(undefined, undefined), { limit: 20, offset: 0 });
  assert.deepEqual(clampPaging("500", "-3"), { limit: 20, offset: 0 });
  assert.deepEqual(clampPaging("10", "95"), { limit: 10, offset: 90 });
  assert.deepEqual(clampPaging("abc", "20"), { limit: 20, offset: 20 });
});

const NOW = 1_000_000_000_000;
const row = (id, requesterId, receiverId, status, ageMs = 0) => ({ id, requesterId, receiverId, status, updatedAt: NOW - ageMs });

test("friend request decisions", () => {
  assert.deepEqual(decideFriendRequest([], 1, NOW), { action: "create" });
  assert.equal(decideFriendRequest([row(1, 2, 1, "ACCEPTED")], 1, NOW).code, "ALREADY_FRIENDS");
  assert.deepEqual(decideFriendRequest([row(1, 2, 1, "PENDING")], 1, NOW), { action: "accept", rowId: 1 });
  assert.equal(decideFriendRequest([row(1, 1, 2, "PENDING")], 1, NOW).code, "REQUEST_EXISTS");
  assert.equal(decideFriendRequest([row(1, 1, 2, "BLOCKED")], 1, NOW).code, "REQUEST_NOT_ALLOWED");
  const cd = decideFriendRequest([row(1, 1, 2, "REJECTED", 1000)], 1, NOW);
  assert.equal(cd.code, "REQUEST_COOLDOWN");
  assert.equal(cd.retryAt, NOW - 1000 + COOLDOWN_MS);
  assert.deepEqual(decideFriendRequest([row(1, 1, 2, "REJECTED", COOLDOWN_MS + 1)], 1, NOW), { action: "reset", rowId: 1 });
  assert.deepEqual(decideFriendRequest([row(1, 2, 1, "REJECTED", 10)], 1, NOW), { action: "replace", rowId: 1 });
});

test("relation shown in search", () => {
  assert.equal(relationOf([], 1, NOW), "none");
  assert.equal(relationOf([row(1, 1, 2, "ACCEPTED")], 1, NOW), "friend");
  assert.equal(relationOf([row(1, 2, 1, "PENDING")], 1, NOW), "request_received");
  assert.equal(relationOf([row(1, 1, 2, "PENDING")], 1, NOW), "request_sent");
  assert.equal(relationOf([row(1, 1, 2, "REJECTED", 5)], 1, NOW), "request_sent", "a refusal is not announced");
  assert.equal(relationOf([row(1, 1, 2, "REJECTED", COOLDOWN_MS + 1)], 1, NOW), "none");
  assert.equal(relationOf([row(1, 2, 1, "REJECTED", 5)], 1, NOW), "none");
});
