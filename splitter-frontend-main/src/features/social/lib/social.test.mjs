import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SearchController } from "./search-controller.ts";
import { friendAction, inviteAction } from "./relation-ui.ts";
import { groupPermissions, deleteConfirmed, deniedReasonKey } from "./permissions.ts";
import { filterFriends, sectionizeFriends } from "./friends-list.ts";
import { socialErrorKey, SOCIAL_ERROR_KEYS, SOCIAL_ERROR_CODES } from "./errors.ts";

// ---- a fake clock and a controllable fetcher
function harness() {
  let now = 0;
  const timers = [];
  const states = [];
  const calls = [];
  const h = {
    states, calls,
    setTimer: (fn, ms) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    advance(ms) { now += ms; for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); } },
  };
  h.fetcher = (q, offset, signal) => new Promise((resolve, reject) => {
    const call = { q, offset, signal, resolve, reject, aborted: false };
    signal.addEventListener("abort", () => { call.aborted = true; reject(Object.assign(new Error("aborted"), { aborted: true })); });
    calls.push(call);
  });
  h.make = (extra = {}) => new SearchController({
    fetcher: h.fetcher, onChange: (s) => states.push(s), classify: (e) => (e?.aborted ? null : e?.code ?? "unknown"),
    setTimer: h.setTimer, clearTimer: h.clearTimer, ...extra,
  });
  return h;
}
const tick = () => new Promise((r) => setImmediate(r));
const u = (id, username = "u" + id) => ({ id, username });

test("search: debounce 400 ms, one request for fast typing, short queries never hit the network", async () => {
  const h = harness(); const c = h.make();
  c.setQuery("a");
  assert.equal(c.getState().status, "tooShort");
  c.setQuery("al"); h.advance(200); c.setQuery("ali"); h.advance(200); c.setQuery("alic");
  assert.equal(h.calls.length, 0, "nothing sent while typing");
  h.advance(399); assert.equal(h.calls.length, 0);
  h.advance(1); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].q, "alic");
  assert.equal(c.getState().status, "loading");
  h.calls[0].resolve({ results: [u(1)], nextOffset: null });
  await tick();
  assert.deepEqual([c.getState().status, c.getState().results.length], ["done", 1]);
});

test("search: a new query aborts the previous request and a late answer is ignored", async () => {
  const h = harness(); const c = h.make();
  c.setQuery("alice"); h.advance(400);
  const first = h.calls[0];
  c.setQuery("bobby"); h.advance(400);
  assert.equal(first.aborted, true);
  const second = h.calls[1];
  second.resolve({ results: [u(2, "bobby")], nextOffset: null });
  await tick();
  first.resolve({ results: [u(1, "alice")], nextOffset: null }); // too late
  await tick();
  assert.deepEqual(c.getState().results.map((r) => r.id), [2]);
  assert.equal(c.getState().query, "bobby");
});

test("search: clearing the field cancels everything; typing again after an error retries", async () => {
  const h = harness(); const c = h.make();
  c.setQuery("alice"); h.advance(400);
  c.setQuery("");
  assert.equal(h.calls[0].aborted, true);
  assert.equal(c.getState().status, "idle");
  c.setQuery("alice"); h.advance(400);
  h.calls[1].reject({ code: "RATE_LIMITED" });
  await tick();
  assert.deepEqual([c.getState().status, c.getState().errorCode], ["error", "RATE_LIMITED"]);
  c.retry();
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve({ results: [u(1)], nextOffset: null });
  await tick();
  assert.equal(c.getState().status, "done");
});

test("search: load more appends without duplicates and stops at the end", async () => {
  const h = harness(); const c = h.make();
  c.setQuery("alice"); h.advance(400);
  h.calls[0].resolve({ results: [u(1), u(2)], nextOffset: 2 });
  await tick();
  c.loadMore();
  assert.equal(c.getState().status, "loadingMore");
  assert.equal(h.calls[1].offset, 2);
  h.calls[1].resolve({ results: [u(2), u(3)], nextOffset: null });
  await tick();
  assert.deepEqual(c.getState().results.map((r) => r.id), [1, 2, 3]);
  c.loadMore();
  assert.equal(h.calls.length, 2, "no more pages");
});

test("search: a failed background refresh keeps the list", async () => {
  const h = harness(); const c = h.make();
  c.setQuery("alice"); h.advance(400);
  h.calls[0].resolve({ results: [u(1)], nextOffset: null });
  await tick();
  c.refresh();
  h.calls[1].reject({ code: "unknown" });
  await tick();
  assert.deepEqual([c.getState().status, c.getState().results.length], ["done", 1]);
});

test("buttons follow the relation / group status", () => {
  assert.deepEqual(friendAction("none"), { kind: "add", labelKey: "social.action.add", enabled: true });
  assert.equal(friendAction("request_sent").kind, "cancel");
  assert.equal(friendAction("request_received").kind, "accept");
  assert.deepEqual([friendAction("friend").kind, friendAction("friend").enabled], ["friends", false]);
  assert.equal(inviteAction("none").kind, "invite");
  assert.equal(inviteAction("invited").kind, "cancel");
  assert.deepEqual([inviteAction("member").kind, inviteAction("member").enabled], ["member", false]);
});

test("permissions: only the owner manages, only a member may leave", () => {
  const o = groupPermissions("owner"), m = groupPermissions("member"), none = groupPermissions(null);
  for (const k of ["canRename", "canInvite", "canCreateLink", "canAddFriends", "canRemoveMembers", "canSeePending", "canTransfer", "canDelete"]) {
    assert.equal(o[k], true, k); assert.equal(m[k], false, k); assert.equal(none[k], false, k);
  }
  assert.deepEqual([o.canLeave, m.canLeave, none.canLeave], [false, true, false]);
  assert.equal(deniedReasonKey("owner", "leave"), "social.group.ownerCannotLeave");
  assert.equal(deniedReasonKey("member", "manage"), "social.group.ownerOnly");
  assert.equal(deleteConfirmed(" Trip ", "Trip"), true);
  assert.equal(deleteConfirmed("trip", "Trip"), false);
  assert.equal(deleteConfirmed("", ""), false);
});

test("friends list: filter by name or ID, A-Z sections, non-letters last", () => {
  const f = [
    { id: 1, username: "bob", uniqueId: "#1111" }, { id: 2, username: "Alice", uniqueId: "#2222" },
    { id: 3, username: "alex", uniqueId: "#3333" }, { id: 4, username: "7zip", uniqueId: "#4444" }, { id: 5, username: "Яна", uniqueId: "#5555" },
  ];
  assert.deepEqual(sectionizeFriends(f).map((s) => [s.title, s.data.map((x) => x.id)]), [["A", [3, 2]], ["B", [1]], ["Я", [5]], ["#", [4]]]);
  assert.deepEqual(filterFriends(f, "AL").map((x) => x.id), [2, 3]);
  assert.deepEqual(filterFriends(f, "#2222").map((x) => x.id), [2]);
  assert.deepEqual(filterFriends(f, "@bo").map((x) => x.id), [1]);
  assert.equal(filterFriends(f, "  ").length, 5);
  assert.deepEqual(sectionizeFriends([]), []);
});

test("every social error key exists in en, ja and uz; codes map to keys", () => {
  assert.equal(socialErrorKey({ code: "ALREADY_MEMBER" }), "social.errors.ALREADY_MEMBER");
  assert.equal(socialErrorKey({ code: "INVITATION_EXISTS", status: 409 }), "social.errors.INVITATION_EXISTS");
  assert.equal(socialErrorKey({ kind: "network" }), "social.errors.offline");
  assert.equal(socialErrorKey({ status: 429 }), "social.errors.RATE_LIMITED");
  assert.equal(socialErrorKey({ code: "WEIRD", status: 500 }), "social.errors.unknown");
  const lookup = (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
  for (const l of ["en", "ja", "uz"]) {
    const j = JSON.parse(fs.readFileSync(new URL(`../../../shared/config/locales/${l}.json`, import.meta.url), "utf8"));
    for (const k of SOCIAL_ERROR_KEYS) assert.equal(typeof lookup(j, k), "string", `${l}: ${k}`);
  }
  // the server's list of codes (src/utils/apiError.ts) must be known to the client
  const server = fs.readFileSync(new URL("../../../../../splitter-backend-main/src/utils/apiError.ts", import.meta.url), "utf8");
  const serverCodes = [...server.matchAll(/^\s+([A-Z_]+): \d{3},$/gm)].map((m) => m[1]);
  assert.ok(serverCodes.length > 20);
  for (const c of serverCodes) assert.ok(SOCIAL_ERROR_CODES.includes(c), `client does not know ${c}`);
});
