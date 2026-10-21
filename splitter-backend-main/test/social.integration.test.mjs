// Black-box tests of search, friends, groups and group invitations against a real server + the separate "splitter_test" DB.
//   npm run test:db && npm run test:integration
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl, testRoot } from "../scripts/test-env.mjs";

const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "Aa1!testpw";
let server;
let serverLog = "";
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

async function api(method, route, { token, json } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (json !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(json); }
  const res = await fetch(BASE + route, { method, headers: h, body: payload });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const uid = () => crypto.randomBytes(3).toString("hex");
async function newUser(name) {
  const username = name ?? `u${uid()}`;
  const r = await api("POST", "/auth/register", { json: { username, email: `${username.replace(/\W/g, "")}_${uid()}@example.test`, password: PW } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, uniqueId: r.data.user.uniqueId, username };
}
const search = (u, q, extra = "") => api("GET", `/friends/search?q=${encodeURIComponent(q)}${extra}`, { token: u.token });
const befriend = async (a, b) => {
  assert.equal((await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } })).status, 200);
  assert.equal((await api("PATCH", "/friends/accept", { token: b.token, json: { uniqueId: a.uniqueId } })).status, 200);
};
const mkGroup = async (owner, name = "Trip") => (await api("POST", "/groups", { token: owner.token, json: { name } })).data;

before(async () => {
  server = spawn(process.execPath, ["--loader", "ts-node/esm", "-r", "dotenv/config", "src/server.ts"], {
    cwd: testRoot,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: testDatabaseUrl(), JWT_SECRET: "integration-test-secret", NODE_ENV: "test", GEMINI_API_KEY: "", SEARCH_IP_LIMIT: "5000", FRIEND_REQUEST_LIMIT: "500", NODE_NO_WARNINGS: "1", REGISTER_LIMIT: "100000", LOGIN_IP_LIMIT: "100000", LOGIN_EMAIL_LIMIT: "100000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + serverLog.slice(-1500));
});
after(async () => { server?.kill(); await db.$disconnect(); });

describe("search", () => {
  const tag = `Zq${uid()}`;
  let me, alice, alice2, bob;
  before(async () => {
    me = await newUser(`${tag}Me`);
    alice = await newUser(`${tag}Alice`);
    alice2 = await newUser(`${tag}Alice`); // same username, different ID
    bob = await newUser(`${tag}Bob`);
  });

  test("by username: exact first, then prefix, then substring; case-insensitive; same names differ by ID", async () => {
    const r = await search(me, `${tag}alice`.toLowerCase());
    assert.equal(r.status, 200);
    assert.deepEqual(new Set(r.data.results.map((x) => x.uniqueId)), new Set([alice.uniqueId, alice2.uniqueId]));
    assert.equal(r.data.results.length, 2);
    const pre = await search(me, `${tag}`);
    assert.equal(pre.data.results.length, 3); // alice, alice2, bob (me excluded)
    const sub = await search(me, `lice`);
    assert.ok(sub.data.results.some((x) => x.uniqueId === alice.uniqueId));
    // exact before prefix: a user literally named "<tag>Al"
    const al = await newUser(`${tag}Al`);
    const order = (await search(me, `${tag}Al`)).data.results.map((x) => x.uniqueId);
    assert.equal(order[0], al.uniqueId);
  });

  test("by ID: #1234, 1234, with a name part, and wrong name part finds nothing", async () => {
    const digits = alice.uniqueId.slice(1);
    assert.equal((await search(me, alice.uniqueId)).data.results[0].uniqueId, alice.uniqueId);
    assert.equal((await search(me, `@${alice.uniqueId}`)).data.results[0].uniqueId, alice.uniqueId);
    assert.ok((await search(me, digits)).data.results.some((x) => x.uniqueId === alice.uniqueId));
    assert.equal((await search(me, `${tag}alice${alice.uniqueId}`)).data.results[0].uniqueId, alice.uniqueId);
    assert.equal((await search(me, `nobodyxyz${alice.uniqueId}`)).data.results.length, 0);
  });

  test("short or empty queries return nothing; too long is rejected", async () => {
    assert.deepEqual((await search(me, "a")).data.results, []);
    assert.equal((await search(me, "a")).data.tooShort, true);
    assert.deepEqual((await search(me, "")).data.results, []);
    assert.equal((await search(me, "x".repeat(80))).status, 400);
  });

  test("never leaks email, never returns myself, requires a token", async () => {
    const r = await search(me, tag);
    const text = JSON.stringify(r.data);
    assert.ok(!text.includes("@example.test") && !text.includes('"email"'));
    assert.ok(!r.data.results.some((x) => x.uniqueId === me.uniqueId));
    assert.deepEqual(Object.keys(r.data.results[0]).sort(), ["avatarUrl", "id", "relation", "uniqueId", "username"]);
    assert.equal((await api("GET", "/friends/search?q=abcd")).status, 401);
  });

  test("relation statuses and the paging window", async () => {
    const carol = await newUser(`${tag}Carol`);
    const get = async (viewer, target) => (await search(viewer, target.uniqueId)).data.results[0].relation;
    assert.equal(await get(me, carol), "none");
    await api("POST", "/friends/request", { token: me.token, json: { uniqueId: carol.uniqueId } });
    assert.equal(await get(me, carol), "request_sent");
    assert.equal(await get(carol, me), "request_received");
    await api("PATCH", "/friends/accept", { token: carol.token, json: { uniqueId: me.uniqueId } });
    assert.equal(await get(me, carol), "friend");
    const page1 = await search(me, tag, "&limit=2");
    assert.equal(page1.data.results.length, 2);
    assert.equal(page1.data.nextOffset, 2);
    const page2 = await search(me, tag, "&limit=2&offset=2");
    assert.ok(page2.data.results.length >= 1);
    assert.ok(!page2.data.results.some((x) => page1.data.results.some((y) => y.id === x.id)));
  });

  test("rate limit: the 31st search within a minute is refused with RATE_LIMITED", async () => {
    const u = await newUser();
    let last;
    for (let i = 0; i < 31; i++) last = await search(u, "abcd");
    assert.equal(last.status, 429);
    assert.equal(last.data.code, "RATE_LIMITED");
  });
});

describe("friends", () => {
  test("request, accept, list (no email), remove", async () => {
    const a = await newUser(), b = await newUser();
    assert.equal((await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } })).status, 200);
    const reqs = await api("GET", "/friends/requests", { token: b.token });
    assert.equal(reqs.data.incoming.length, 1);
    assert.equal((await api("GET", "/friends/requests", { token: a.token })).data.outgoing.length, 1);
    assert.ok(!JSON.stringify(reqs.data).includes("email"));
    await api("PATCH", "/friends/accept", { token: b.token, json: { uniqueId: a.uniqueId } });
    const list = await api("GET", "/friends", { token: a.token });
    assert.equal(list.data.length, 1);
    assert.ok(!("email" in list.data[0]));
    assert.equal((await api("DELETE", `/friends/${encodeURIComponent(b.uniqueId)}`, { token: a.token })).data.removed, true);
    assert.equal((await api("GET", "/friends", { token: b.token })).data.length, 0);
    assert.equal((await api("DELETE", `/friends/${encodeURIComponent(b.uniqueId)}`, { token: a.token })).data.removed, false);
  });

  test("error codes: self, duplicate, already friends, unknown user, awaiting response", async () => {
    const a = await newUser(), b = await newUser();
    const post = (u, t) => api("POST", "/friends/request", { token: u.token, json: { uniqueId: t } });
    assert.equal((await post(a, a.uniqueId)).data.code, "CANNOT_ADD_SELF");
    assert.equal((await post(a, "#0000")).data.code, "NOT_FOUND");
    assert.equal((await api("POST", "/friends/request", { token: a.token, json: {} })).data.code, "VALIDATION");
    await post(a, b.uniqueId);
    const dup = await post(a, b.uniqueId);
    assert.deepEqual([dup.status, dup.data.code], [409, "REQUEST_EXISTS"]);
    await api("PATCH", "/friends/accept", { token: b.token, json: { uniqueId: a.uniqueId } });
    assert.equal((await post(a, b.uniqueId)).data.code, "ALREADY_FRIENDS");
    assert.equal((await post(b, a.uniqueId)).data.code, "ALREADY_FRIENDS");
  });

  test("crossing requests are accepted; cancelling my request; cancel cannot delete a refusal", async () => {
    const a = await newUser(), b = await newUser(), c = await newUser();
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } });
    const cross = await api("POST", "/friends/request", { token: b.token, json: { uniqueId: a.uniqueId } });
    assert.equal(cross.data.action, "accepted");
    // cancel
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: c.uniqueId } });
    assert.equal((await api("DELETE", `/friends/requests/${encodeURIComponent(c.uniqueId)}`, { token: a.token })).data.removed, true);
    assert.equal((await api("GET", "/friends/requests", { token: c.token })).data.incoming.length, 0);
    assert.equal((await api("DELETE", `/friends/requests/${encodeURIComponent(c.uniqueId)}`, { token: a.token })).data.removed, false);
    // an accepted friendship is not removable through the cancel route
    assert.equal((await api("DELETE", `/friends/requests/${encodeURIComponent(b.uniqueId)}`, { token: a.token })).data.removed, false);
    assert.equal((await api("GET", "/friends", { token: a.token })).data.length, 1);
  });

  test("reject: sender sees 'sent', cannot retry within the cooldown, cannot bypass it by cancelling; the rejector may ask later", async () => {
    const a = await newUser(), b = await newUser();
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } });
    assert.equal((await api("PATCH", "/friends/reject", { token: b.token, json: { uniqueId: a.uniqueId } })).status, 200);
    assert.equal((await api("PATCH", "/friends/reject", { token: b.token, json: { uniqueId: a.uniqueId } })).data.code, "NOT_FOUND");
    const retry = await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } });
    assert.deepEqual([retry.status, retry.data.code], [429, "REQUEST_COOLDOWN"]);
    assert.ok(retry.data.retryAt);
    assert.equal((await search(a, b.uniqueId)).data.results[0].relation, "request_sent");
    assert.equal((await api("DELETE", `/friends/requests/${encodeURIComponent(b.uniqueId)}`, { token: a.token })).data.removed, false);
    assert.equal((await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } })).data.code, "REQUEST_COOLDOWN");
    // b refused a; now b wants to add a: allowed at once
    assert.equal((await search(b, a.uniqueId)).data.results[0].relation, "none");
    const reverse = await api("POST", "/friends/request", { token: b.token, json: { uniqueId: a.uniqueId } });
    assert.equal(reverse.status, 200);
    assert.equal((await api("GET", "/friends/requests", { token: a.token })).data.incoming.length, 1);
  });

  test("after the cooldown the sender may ask again", async () => {
    const a = await newUser(), b = await newUser();
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } });
    await api("PATCH", "/friends/reject", { token: b.token, json: { uniqueId: a.uniqueId } });
    await db.friendship.updateMany({ where: { requesterId: a.id, receiverId: b.id }, data: { updatedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) } });
    const again = await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.uniqueId } });
    assert.equal(again.status, 200);
    assert.equal((await api("GET", "/friends/requests", { token: b.token })).data.incoming.length, 1);
  });

  test("friend invite link: works, expired/garbage tokens get codes, self is a no-op", async () => {
    const a = await newUser(), b = await newUser();
    const inv = await api("POST", "/friends/invite", { token: a.token, json: { expiresInSeconds: 300 } });
    assert.equal((await api("POST", "/friends/join", { token: b.token, json: { token: inv.data.token } })).data.action, "created");
    assert.equal((await api("POST", "/friends/join", { token: b.token, json: { token: inv.data.token } })).data.action, "existing");
    assert.equal((await api("POST", "/friends/join", { token: a.token, json: { token: inv.data.token } })).data.action, "self");
    const bad = await api("POST", "/friends/join", { token: b.token, json: { token: "not-a-token" } });
    assert.deepEqual([bad.status, bad.data.code], [400, "TOKEN_INVALID"]);
    const jwt = (await import("jsonwebtoken")).default;
    const expired = jwt.sign({ typ: "friend_invite", inviterId: a.id, exp: Math.floor(Date.now() / 1000) - 10 }, "integration-test-secret");
    assert.equal((await api("POST", "/friends/join", { token: b.token, json: { token: expired } })).data.code, "TOKEN_EXPIRED");
    // a refusal is not overridden when the sender is BLOCKED
    const c = await newUser();
    await db.friendship.create({ data: { requesterId: c.id, receiverId: a.id, status: "BLOCKED" } });
    const inv2 = await api("POST", "/friends/invite", { token: a.token, json: {} });
    assert.equal((await api("POST", "/friends/join", { token: c.token, json: { token: inv2.data.token } })).data.code, "REQUEST_NOT_ALLOWED");
  });
});

describe("groups", () => {
  test("create (validation), list with counts, rename, details only for members", async () => {
    const owner = await newUser(), stranger = await newUser();
    assert.equal((await api("POST", "/groups", { token: owner.token, json: { name: "  " } })).data.code, "VALIDATION");
    assert.equal((await api("POST", "/groups", { token: owner.token, json: { name: "x".repeat(61) } })).data.code, "VALIDATION");
    const g = await mkGroup(owner, "  Trip   2026 ");
    assert.equal(g.name, "Trip 2026");
    const list = await api("GET", "/groups", { token: owner.token });
    assert.equal(list.data[0].counts.members, 1);
    assert.equal(list.data[0].myRole, "owner");
    assert.equal(list.data[0].lastSession, null);
    assert.ok(!JSON.stringify(list.data).includes("email"));
    assert.equal((await api("PATCH", `/groups/${g.id}`, { token: owner.token, json: { name: "Renamed" } })).data.name, "Renamed");
    assert.equal((await api("PATCH", `/groups/${g.id}`, { token: stranger.token, json: { name: "Hack" } })).data.code, "FORBIDDEN");
    assert.equal((await api("GET", `/groups/${g.id}`, { token: stranger.token })).data.code, "FORBIDDEN");
    assert.equal((await api("GET", `/groups/999999`, { token: owner.token })).data.code, "NOT_FOUND");
  });

  test("direct add works for friends only (several at once); strangers need an invitation", async () => {
    const owner = await newUser(), f1 = await newUser(), f2 = await newUser(), stranger = await newUser();
    await befriend(owner, f1); await befriend(owner, f2);
    const g = await mkGroup(owner);
    const r = await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueIds: [f1.uniqueId, f2.uniqueId, stranger.uniqueId, "#0000", f1.uniqueId] } });
    assert.deepEqual(r.data.added.sort(), [f1.uniqueId, f2.uniqueId].sort());
    assert.deepEqual(r.data.skipped.map((s) => s.code).sort(), ["FRIENDSHIP_REQUIRED", "NOT_FOUND"]);
    assert.equal((await api("GET", "/groups", { token: owner.token })).data[0].counts.members, 3);
    const single = await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueId: stranger.uniqueId } });
    assert.deepEqual([single.status, single.data.code], [403, "FRIENDSHIP_REQUIRED"]);
    assert.equal((await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueId: f1.uniqueId } })).data.code, "ALREADY_MEMBER");
    assert.equal((await api("POST", `/groups/${g.id}/members`, { token: f1.token, json: { uniqueId: stranger.uniqueId } })).data.code, "FORBIDDEN");
  });

  test("remove member, leave, owner cannot leave, rights of non-owners", async () => {
    const owner = await newUser(), m1 = await newUser(), m2 = await newUser();
    await befriend(owner, m1); await befriend(owner, m2);
    const g = await mkGroup(owner);
    await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueIds: [m1.uniqueId, m2.uniqueId] } });
    assert.equal((await api("DELETE", `/groups/${g.id}/members/${encodeURIComponent(m2.uniqueId)}`, { token: m1.token })).data.code, "FORBIDDEN");
    assert.equal((await api("DELETE", `/groups/${g.id}/members/${encodeURIComponent(owner.uniqueId)}`, { token: owner.token })).data.code, "CANNOT_REMOVE_OWNER");
    assert.equal((await api("DELETE", `/groups/${g.id}/members/${encodeURIComponent(m2.uniqueId)}`, { token: owner.token })).data.removed, true);
    assert.equal((await api("POST", `/groups/${g.id}/leave`, { token: m1.token })).data.left, true);
    assert.equal((await api("POST", `/groups/${g.id}/leave`, { token: m1.token })).data.left, false);
    assert.equal((await api("POST", `/groups/${g.id}/leave`, { token: owner.token })).data.code, "OWNER_CANNOT_LEAVE");
    assert.equal((await api("GET", "/groups", { token: m1.token })).data.length, 0);
  });

  test("transfer ownership: explicit, members only, old owner stays a member, old rights gone", async () => {
    const owner = await newUser(), m = await newUser(), outsider = await newUser();
    await befriend(owner, m);
    const g = await mkGroup(owner);
    await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueId: m.uniqueId } });
    assert.equal((await api("POST", `/groups/${g.id}/transfer`, { token: m.token, json: { uniqueId: m.uniqueId } })).data.code, "FORBIDDEN");
    assert.equal((await api("POST", `/groups/${g.id}/transfer`, { token: owner.token, json: { uniqueId: outsider.uniqueId } })).data.code, "NOT_A_MEMBER");
    assert.equal((await api("POST", `/groups/${g.id}/transfer`, { token: owner.token, json: { uniqueId: m.uniqueId } })).data.transferred, true);
    const d = await api("GET", `/groups/${g.id}`, { token: owner.token });
    assert.equal(d.data.role, "member");
    assert.equal(d.data.members.length, 2);
    assert.equal(d.data.members[0].uniqueId, m.uniqueId);
    assert.equal((await api("PATCH", `/groups/${g.id}`, { token: owner.token, json: { name: "x" } })).data.code, "FORBIDDEN");
    assert.equal((await api("PATCH", `/groups/${g.id}`, { token: m.token, json: { name: "Mine" } })).status, 200);
  });

  test("delete: owner only; bills stay (detached), members lose the group", async () => {
    const owner = await newUser(), m = await newUser();
    await befriend(owner, m);
    const g = await mkGroup(owner);
    await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueId: m.uniqueId } });
    const s = await db.session.create({ data: { creatorId: owner.id, groupId: g.id } });
    assert.equal((await api("DELETE", `/groups/${g.id}`, { token: m.token })).data.code, "FORBIDDEN");
    assert.equal((await api("DELETE", `/groups/${g.id}`, { token: owner.token })).status, 200);
    assert.equal((await api("GET", "/groups", { token: m.token })).data.length, 0);
    const kept = await db.session.findUnique({ where: { id: s.id } });
    assert.ok(kept && kept.groupId === null, "the bill survives without the group");
    assert.equal((await api("DELETE", `/groups/${g.id}`, { token: owner.token })).data.code, "NOT_FOUND");
  });

  test("group invite link: join once, errors with codes, owner change kills old links", async () => {
    const owner = await newUser(), a = await newUser(), b = await newUser();
    const g = await mkGroup(owner);
    const link = await api("POST", `/groups/${g.id}/invite`, { token: owner.token, json: {} });
    assert.equal((await api("POST", `/groups/${g.id}/invite`, { token: a.token, json: {} })).data.code, "FORBIDDEN");
    const joined = await api("POST", "/groups/join", { token: a.token, json: { token: link.data.token } });
    assert.equal(joined.data.joined, true);
    assert.equal((await api("POST", "/groups/join", { token: a.token, json: { token: link.data.token } })).data.code, "ALREADY_MEMBER");
    assert.equal((await api("POST", "/groups/join", { token: owner.token, json: { token: link.data.token } })).data.code, "ALREADY_MEMBER");
    assert.equal((await api("POST", "/groups/join", { token: b.token, json: { token: "garbage" } })).data.code, "TOKEN_INVALID");
    const jwt = (await import("jsonwebtoken")).default;
    const expired = jwt.sign({ typ: "group_invite", gid: g.id, oid: owner.id, exp: Math.floor(Date.now() / 1000) - 5 }, "integration-test-secret");
    assert.equal((await api("POST", "/groups/join", { token: b.token, json: { token: expired } })).data.code, "TOKEN_EXPIRED");
    await api("POST", `/groups/${g.id}/transfer`, { token: owner.token, json: { uniqueId: a.uniqueId } });
    assert.equal((await api("POST", "/groups/join", { token: b.token, json: { token: link.data.token } })).data.code, "TOKEN_INVALID");
  });
});

describe("group invitations", () => {
  const invite = (owner, g, target) => api("POST", `/groups/${g.id}/invitations`, { token: owner.token, json: { uniqueId: target.uniqueId } });

  test("invite any user -> pending, not a member yet -> accept -> member; no friendship created", async () => {
    const owner = await newUser(), guest = await newUser();
    const g = await mkGroup(owner, "Secret trip");
    const r = await invite(owner, g, guest);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.invitation.status, "PENDING");
    assert.equal((await api("GET", "/groups", { token: guest.token })).data.length, 0, "no automatic membership");
    assert.equal((await api("GET", `/groups/${g.id}`, { token: guest.token })).data.code, "FORBIDDEN", "no group data before accepting");

    const inbox = await api("GET", "/groups/invitations", { token: guest.token });
    assert.equal(inbox.data.length, 1);
    assert.deepEqual(Object.keys(inbox.data[0]).sort(), ["createdAt", "group", "id", "inviter"]);
    assert.deepEqual(Object.keys(inbox.data[0].group).sort(), ["id", "name"]);
    assert.equal(inbox.data[0].inviter.uniqueId, owner.uniqueId);
    assert.ok(!JSON.stringify(inbox.data).includes("email"));

    const ok = await api("PATCH", `/groups/invitations/${inbox.data[0].id}/accept`, { token: guest.token });
    assert.deepEqual([ok.status, ok.data.status], [200, "ACCEPTED"]);
    const mine = await api("GET", "/groups", { token: guest.token });
    assert.equal(mine.data[0].counts.members, 2);
    assert.equal((await api("GET", "/friends", { token: guest.token })).data.length, 0, "accepting does not create a friendship");
    assert.equal((await api("GET", "/groups/invitations", { token: guest.token })).data.length, 0);
    assert.equal((await api("PATCH", `/groups/invitations/${inbox.data[0].id}/accept`, { token: guest.token })).data.code, "INVITATION_NOT_PENDING");
  });

  test("decline, cancel by the owner, and inviting again afterwards", async () => {
    const owner = await newUser(), a = await newUser(), b = await newUser();
    const g = await mkGroup(owner);
    const ia = (await invite(owner, g, a)).data.invitation;
    const decl = await api("PATCH", `/groups/invitations/${ia.id}/decline`, { token: a.token });
    assert.equal(decl.data.status, "DECLINED");
    assert.equal((await api("GET", "/groups", { token: a.token })).data.length, 0);
    assert.equal((await api("PATCH", `/groups/invitations/${ia.id}/accept`, { token: a.token })).data.code, "INVITATION_NOT_PENDING");

    const ib = (await invite(owner, g, b)).data.invitation;
    const pend = await api("GET", `/groups/${g.id}/invitations`, { token: owner.token });
    assert.deepEqual(pend.data.map((x) => x.invitee.uniqueId), [b.uniqueId]);
    assert.equal((await api("DELETE", `/groups/${g.id}/invitations/${ib.id}`, { token: a.token })).data.code, "FORBIDDEN");
    assert.equal((await api("DELETE", `/groups/${g.id}/invitations/${ib.id}`, { token: owner.token })).data.status, "CANCELLED");
    assert.equal((await api("DELETE", `/groups/${g.id}/invitations/${ib.id}`, { token: owner.token })).data.code, "INVITATION_NOT_PENDING");
    assert.equal((await api("GET", "/groups/invitations", { token: b.token })).data.length, 0);
    assert.equal((await api("PATCH", `/groups/invitations/${ib.id}/accept`, { token: b.token })).data.code, "INVITATION_NOT_PENDING");
    assert.equal((await invite(owner, g, a)).status, 200, "a declined user can be invited again");
    assert.equal((await api("GET", `/groups/${g.id}/invitations`, { token: owner.token })).data.length, 1);
  });

  test("error codes: self, duplicate pending, already a member, unknown user, missing target; a stranger cannot invite or see the list", async () => {
    const owner = await newUser(), a = await newUser(), outsider = await newUser(), m = await newUser();
    await befriend(owner, m);
    const g = await mkGroup(owner);
    await api("POST", `/groups/${g.id}/members`, { token: owner.token, json: { uniqueId: m.uniqueId } });
    assert.equal((await invite(owner, g, owner)).data.code, "CANNOT_INVITE_SELF");
    assert.equal((await invite(owner, g, m)).data.code, "ALREADY_MEMBER");
    assert.equal((await api("POST", `/groups/${g.id}/invitations`, { token: owner.token, json: { uniqueId: "#0000" } })).data.code, "NOT_FOUND");
    assert.equal((await api("POST", `/groups/${g.id}/invitations`, { token: owner.token, json: {} })).data.code, "VALIDATION");
    await invite(owner, g, a);
    const dup = await invite(owner, g, a);
    assert.deepEqual([dup.status, dup.data.code], [409, "INVITATION_EXISTS"]);
    // by numeric userId works too
    const viaId = await api("POST", `/groups/${g.id}/invitations`, { token: owner.token, json: { userId: outsider.id } });
    assert.equal(viaId.status, 200);
    // non-owners (members included) cannot invite or list
    assert.equal((await invite(m, g, outsider)).data.code, "FORBIDDEN");
    assert.equal((await invite(outsider, g, a)).data.code, "FORBIDDEN");
    assert.equal((await api("GET", `/groups/${g.id}/invitations`, { token: m.token })).data.code, "FORBIDDEN");
    // somebody else's invitation cannot be answered
    const stolen = (await api("GET", "/groups/invitations", { token: a.token })).data[0];
    assert.equal((await api("PATCH", `/groups/invitations/${stolen.id}/accept`, { token: outsider.token })).data.code, "NOT_FOUND");
    assert.equal((await api("PATCH", `/groups/invitations/${stolen.id}/decline`, { token: outsider.token })).data.code, "NOT_FOUND");
  });

  test("limits: 20 pending per group, 30 per day per owner; the database allows one pending row per pair", async () => {
    const owner = await newUser();
    const g = await mkGroup(owner);
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await newUser());
    for (let i = 0; i < 20; i++) assert.equal((await invite(owner, g, people[i])).status, 200);
    const over = await invite(owner, g, people[20]);
    assert.deepEqual([over.status, over.data.code], [429, "INVITE_LIMIT"]);

    const owner2 = await newUser();
    const g2 = await mkGroup(owner2);
    const g3 = await mkGroup(owner2);
    const many = [];
    for (let i = 0; i < 31; i++) many.push(await newUser());
    for (let i = 0; i < 15; i++) assert.equal((await invite(owner2, g2, many[i])).status, 200);
    for (let i = 15; i < 30; i++) assert.equal((await invite(owner2, g3, many[i])).status, 200);
    assert.equal((await invite(owner2, g3, many[30])).data.code, "INVITE_LIMIT");

    await assert.rejects(() => db.groupInvitation.create({ data: { groupId: g.id, inviterId: owner.id, inviteeId: people[0].id } }), /Unique constraint/);
  });

  test("search with groupId reports member / invited / none; only group people may ask", async () => {
    const owner = await newUser(`Gq${uid()}`), invited = await newUser(`Gq${uid()}`), plain = await newUser(`Gq${uid()}`), stranger = await newUser();
    const g = await mkGroup(owner);
    await invite(owner, g, invited);
    const status = async (u) => (await search(owner, u.uniqueId, `&groupId=${g.id}`)).data.results[0].groupStatus;
    assert.equal(await status(invited), "invited");
    assert.equal(await status(plain), "none");
    const asOwner = await search(stranger, owner.uniqueId, `&groupId=${g.id}`);
    assert.equal(asOwner.data.code, "FORBIDDEN");
    await api("PATCH", `/groups/invitations/${(await api("GET", "/groups/invitations", { token: invited.token })).data[0].id}/accept`, { token: invited.token });
    assert.equal(await status(invited), "member");
    assert.equal((await search(invited, owner.uniqueId, `&groupId=${g.id}`)).data.results[0].groupStatus, "member", "the owner counts as a member");
  });

  test("deleting the group or an account removes its invitations", async () => {
    const owner = await newUser(), guest = await newUser();
    const g = await mkGroup(owner);
    await invite(owner, g, guest);
    await api("DELETE", `/groups/${g.id}`, { token: owner.token });
    assert.equal(await db.groupInvitation.count({ where: { groupId: g.id } }), 0);
    assert.equal((await api("GET", "/groups/invitations", { token: guest.token })).data.length, 0);

    const g2 = await mkGroup(owner);
    await invite(owner, g2, guest);
    const del = await api("DELETE", "/users/me", { token: guest.token, json: { password: PW } });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.equal(await db.groupInvitation.count({ where: { groupId: g2.id } }), 0);
    assert.equal((await api("GET", `/groups/${g2.id}/invitations`, { token: owner.token })).data.length, 0);
  });

  test("401 without a token everywhere", async () => {
    for (const [m, p] of [["GET", "/groups/invitations"], ["POST", "/groups/1/invitations"], ["GET", "/groups/1/invitations"], ["PATCH", "/groups/invitations/1/accept"], ["DELETE", "/groups/1/invitations/1"], ["POST", "/groups/1/transfer"], ["POST", "/groups/1/leave"]]) {
      assert.equal((await api(m, p)).status, 401, `${m} ${p}`);
    }
  });
});
