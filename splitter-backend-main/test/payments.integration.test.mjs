// Payment tracking against a real server and the separate "splitter_test" database.
// Splitter only RECORDS debts and settlements made outside the app; nothing here moves money.
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
let log = "";
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

async function api(method, route, { token, json, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  const res = await fetch(BASE + route, { method, headers: h, body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const uid = () => crypto.randomBytes(3).toString("hex");
async function user(prefix = "p") {
  const name = `${prefix}${uid()}`;
  const r = await api("POST", "/auth/register", { json: { username: name, email: `${name}@example.test`, password: PW } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, uniqueId: r.data.user.uniqueId, username: name };
}
const person = (u) => ({ uniqueId: u.uniqueId, username: u.username });

/** payer creates and finalizes a bill split equally between `people` (payer included). */
async function bill(payer, people, { price = 100, currency = "USD", name = "Dinner", sessionId } = {}) {
  const id = sessionId ?? (await api("POST", "/sessions", { token: payer.token, json: {} })).data.id;
  const r = await api("POST", "/sessions/finalize", {
    token: payer.token,
    json: { sessionId: id, sessionName: name, currency, participants: people.map(person), items: [{ id: "i1", name: "Food", quantity: 1, price, assignedTo: people.map((p) => p.uniqueId) }] },
  });
  return { id, r };
}
const ledger = (u, sid) => api("GET", `/obligations/session/${sid}`, { token: u.token });
const debtOf = async (viewer, sid, debtor) => (await ledger(viewer, sid)).data.obligations.find((o) => o.debtor.id === debtor.id);
const pay = (u, oid, json = {}, key) => api("POST", `/obligations/${oid}/payments`, { token: u.token, json, ...(key ? { headers: { "Idempotency-Key": key } } : {}) });

before(async () => {
  server = spawn(process.execPath, ["--loader", "ts-node/esm", "-r", "dotenv/config", "src/server.ts"], {
    cwd: testRoot,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: testDatabaseUrl(), JWT_SECRET: "integration-test-secret", NODE_ENV: "test", GEMINI_API_KEY: "", REGISTER_LIMIT: "100000", LOGIN_IP_LIMIT: "100000", LOGIN_EMAIL_LIMIT: "100000", PAYMENT_WRITE_LIMIT: "100000", NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + log.slice(-1500));
});
after(async () => { server?.kill(); await db.$disconnect(); });

describe("finalize creates debts", () => {
  test("everyone but the payer owes their share, in exact minor units; payer's own share creates nothing", async () => {
    const a = await user("pa"), b = await user("pb"), c = await user("pc");
    const { id, r } = await bill(a, [a, b, c], { price: 100 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.totals.grandTotalMinor, 10000);
    const l = await ledger(a, id);
    assert.equal(l.status, 200);
    assert.equal(l.data.obligations.length, 2);
    const shares = r.data.totals.byParticipant.map((p) => p.amountMinor);
    assert.equal(shares.reduce((s, v) => s + v, 0), 10000, "no lost cents");
    assert.equal(l.data.totals.amountMinor, 10000 - r.data.totals.byParticipant.find((p) => p.uniqueId === a.uniqueId).amountMinor);
    assert.ok(l.data.obligations.every((o) => o.status === "UNPAID" && o.creditor.id === a.id && o.currency === "USD"));
    assert.ok(l.data.events.every((e) => e.type === "CREATED" && e.actor.id === a.id));
    assert.ok(!JSON.stringify(l.data).includes("@example.test"), "no e-mails");
  });

  test("zero-decimal currencies are split in whole units (no phantom fractions)", async () => {
    const a = await user(), b = await user(), c = await user();
    const { id, r } = await bill(a, [a, b, c], { price: 100, currency: "UZS" });
    assert.deepEqual(r.data.totals.byParticipant.map((p) => p.amountMinor).sort(), [33, 33, 34]);
    assert.ok(r.data.totals.byParticipant.every((p) => Number.isInteger(p.amountOwed)));
    assert.equal(r.data.totals.grandTotalMinor, 100);
    assert.ok((await ledger(a, id)).data.obligations.every((o) => Number.isInteger(o.amountMinor) && o.amountMinor >= 33));
  });

  test("re-finalizing: same numbers keep the debts; changes before a payment replace them; after a payment they are refused", async () => {
    const a = await user(), b = await user();
    const first = await bill(a, [a, b], { price: 50 });
    const before = (await ledger(a, first.id)).data.obligations;
    assert.equal((await bill(a, [a, b], { price: 50, sessionId: first.id })).r.status, 200);
    assert.deepEqual((await ledger(a, first.id)).data.obligations.map((o) => o.id), before.map((o) => o.id), "nothing rewritten");
    assert.equal((await bill(a, [a, b], { price: 60, sessionId: first.id })).r.status, 200);
    const after = (await ledger(a, first.id)).data;
    assert.equal(after.obligations.length, 1);
    assert.equal(after.obligations[0].amountMinor, 3000);
    assert.ok(after.events.some((e) => e.type === "CANCELLED"), "the replacement is visible in the log");
    await pay(b, after.obligations[0].id, { amountMinor: 100 });
    const locked = await bill(a, [a, b], { price: 80, sessionId: first.id });
    assert.deepEqual([locked.r.status, locked.r.data.code], [409, "SESSION_LOCKED"]);
    assert.equal((await bill(a, [a, b], { price: 60, sessionId: first.id })).r.status, 200, "unchanged numbers are still fine");
  });
});

describe("payment cycle", () => {
  test("debtor marks 'I paid' -> pending; payer confirms -> paid; every step is logged with author and time", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 20 });
    const o = await debtOf(b, id, b);
    assert.deepEqual(o.allowedActions, ["markPaid"]);
    const m = await pay(b, o.id, { method: "cash", note: "paid at the table" });
    assert.equal(m.status, 200, JSON.stringify(m.data));
    assert.equal(m.data.payment.status, "PENDING");
    let now = await debtOf(a, id, b);
    assert.equal(now.status, "PAID_PENDING_CONFIRMATION");
    assert.deepEqual(now.allowedActions.sort(), ["confirm", "forgive", "recordReceived", "reject", "remind"].sort());
    assert.equal(now.outstandingMinor, 1000, "a mark is not money received yet");
    const c = await api("POST", `/obligations/${o.id}/payments/${m.data.payment.id}/confirm`, { token: a.token });
    assert.deepEqual([c.status, c.data.status], [200, "PAID"]);
    const l = (await ledger(b, id)).data;
    assert.deepEqual(l.events.map((e) => [e.type, e.actor.id]), [["CREATED", a.id], ["PAYMENT_MARKED", b.id], ["PAYMENT_CONFIRMED", a.id]]);
    assert.ok(l.events.every((e) => e.createdAt));
    assert.equal(l.events[1].note, "paid at the table");
    assert.deepEqual(l.totals, { currency: "USD", amountMinor: 1000, settledMinor: 1000, pendingMinor: 0, outstandingMinor: 0, forgivenMinor: 0 });
    assert.equal((await pay(b, o.id, { amountMinor: 1 })).data.code, "OBLIGATION_CLOSED");
  });

  test("partial payments add up; overpayment is refused; the payer can record 'received' directly", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 100 });
    const o = await debtOf(a, id, b);
    assert.equal(o.amountMinor, 5000);
    const m1 = await pay(b, o.id, { amountMinor: 1500, method: "transfer" });
    await api("POST", `/obligations/${o.id}/payments/${m1.data.payment.id}/confirm`, { token: a.token });
    assert.equal((await debtOf(a, id, b)).status, "PARTIALLY_PAID");
    const over = await pay(b, o.id, { amountMinor: 3501 });
    assert.deepEqual([over.status, over.data.code, over.data.recordableMinor], [409, "OVERPAYMENT", 3500]);
    const pending = await pay(b, o.id, { amountMinor: 2000 });
    assert.equal(pending.status, 200);
    assert.equal((await pay(a, o.id, { amountMinor: 1501 })).data.code, "OVERPAYMENT", "pending marks reserve their part");
    const rec = await pay(a, o.id, { amountMinor: 1500, method: "cash" });
    assert.equal(rec.data.payment.status, "CONFIRMED");
    let now = await debtOf(a, id, b);
    assert.deepEqual([now.status, now.confirmedMinor, now.pendingMinor, now.outstandingMinor], ["PAID_PENDING_CONFIRMATION", 3000, 2000, 2000]);
    await api("POST", `/obligations/${o.id}/payments/${pending.data.payment.id}/confirm`, { token: a.token });
    now = await debtOf(a, id, b);
    assert.deepEqual([now.status, now.confirmedMinor, now.outstandingMinor], ["PAID", 5000, 0]);
    for (const bad of [0, -5, 1.5, "10"]) assert.equal((await pay(b, o.id, { amountMinor: bad })).data.code === "VALIDATION" || (await pay(b, o.id, { amountMinor: bad })).data.code === "OBLIGATION_CLOSED", true, String(bad));
  });

  test("reject needs a reason, frees the amount and is logged; the debtor can mark again", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 10 });
    const o = await debtOf(a, id, b);
    const m = await pay(b, o.id);
    assert.equal((await api("POST", `/obligations/${o.id}/payments/${m.data.payment.id}/reject`, { token: a.token, json: {} })).data.code, "VALIDATION");
    const r = await api("POST", `/obligations/${o.id}/payments/${m.data.payment.id}/reject`, { token: a.token, json: { reason: "Nothing arrived yet" } });
    assert.deepEqual([r.status, r.data.status], [200, "UNPAID"]);
    assert.equal((await api("POST", `/obligations/${o.id}/payments/${m.data.payment.id}/confirm`, { token: a.token })).data.code, "PAYMENT_NOT_PENDING");
    const l = (await ledger(b, id)).data;
    assert.equal(l.obligations[0].payments[0].status, "REJECTED");
    assert.equal(l.obligations[0].payments[0].rejectionReason, "Nothing arrived yet");
    assert.equal(l.events.at(-1).type, "PAYMENT_REJECTED");
    assert.equal((await pay(b, o.id)).status, 200);
  });

  test("forgive: blocked while a mark is pending, then final; nothing can be paid afterwards", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 30 });
    const o = await debtOf(a, id, b);
    const m = await pay(b, o.id, { amountMinor: 500 });
    assert.equal((await api("POST", `/obligations/${o.id}/forgive`, { token: a.token })).data.code, "PENDING_PAYMENTS");
    await api("POST", `/obligations/${o.id}/payments/${m.data.payment.id}/confirm`, { token: a.token });
    const f = await api("POST", `/obligations/${o.id}/forgive`, { token: a.token, json: { note: "my treat" } });
    assert.deepEqual([f.status, f.data.status], [200, "FORGIVEN"]);
    const now = await debtOf(b, id, b);
    assert.deepEqual([now.status, now.outstandingMinor, now.allowedActions], ["FORGIVEN", 0, []]);
    assert.equal((await pay(b, o.id)).data.code, "OBLIGATION_CLOSED");
    assert.equal((await api("POST", `/obligations/${o.id}/forgive`, { token: a.token })).data.code, "OBLIGATION_CLOSED");
    const ev = (await ledger(a, id)).data.events.at(-1);
    assert.deepEqual([ev.type, ev.amountMinor, ev.note], ["FORGIVEN", 1000, "my treat"]);
  });
});

describe("permissions", () => {
  test("outsiders see nothing; debtors cannot confirm or forgive; another participant cannot touch someone else's debt", async () => {
    const a = await user(), b = await user(), c = await user(), outsider = await user();
    const { id } = await bill(a, [a, b, c], { price: 30 });
    const ob = await debtOf(a, id, b);
    assert.equal((await ledger(outsider, id)).status, 404);
    assert.equal((await pay(outsider, ob.id)).status, 404);
    assert.equal((await api("POST", `/obligations/${ob.id}/forgive`, { token: outsider.token })).status, 404);
    assert.equal((await api("GET", `/obligations/session/${id}/statement`, { token: outsider.token })).status, 404);
    // c is in the bill: may see it, may not act on b's debt
    assert.equal((await ledger(c, id)).status, 200);
    assert.equal((await pay(c, ob.id)).data.code, "FORBIDDEN");
    const m = await pay(b, ob.id);
    assert.equal((await api("POST", `/obligations/${ob.id}/payments/${m.data.payment.id}/confirm`, { token: b.token })).data.code, "FORBIDDEN", "no self-confirmation");
    assert.equal((await api("POST", `/obligations/${ob.id}/payments/${m.data.payment.id}/reject`, { token: c.token, json: { reason: "x" } })).data.code, "FORBIDDEN");
    assert.equal((await api("POST", `/obligations/${ob.id}/forgive`, { token: b.token })).data.code, "FORBIDDEN");
    assert.equal((await api("POST", `/obligations/${ob.id}/remind`, { token: b.token })).data.code, "FORBIDDEN");
    assert.equal((await api("GET", `/obligations/session/${id}`)).status, 401);
  });
});

describe("idempotency and races", () => {
  test("the same Idempotency-Key never records twice, sequentially or at the same moment", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 100 });
    const o = await debtOf(b, id, b);
    const key = "pay-" + uid() + uid();
    const first = await pay(b, o.id, { amountMinor: 1000 }, key);
    const again = await pay(b, o.id, { amountMinor: 1000 }, key);
    assert.deepEqual([again.data.replayed, again.data.payment.id], [true, first.data.payment.id]);
    const key2 = "pay-" + uid() + uid();
    const both = await Promise.all([pay(b, o.id, { amountMinor: 500 }, key2), pay(b, o.id, { amountMinor: 500 }, key2)]);
    assert.equal(both[0].data.payment.id, both[1].data.payment.id);
    assert.equal(await db.obligationPayment.count({ where: { obligationId: o.id } }), 2);
    assert.equal((await debtOf(a, id, b)).pendingMinor, 1500);
  });

  test("concurrent payments without a key can never exceed the debt", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 20 });
    const o = await debtOf(b, id, b);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(b, o.id, { amountMinor: 400 })));
    const ok = results.filter((r) => r.status === 200).length;
    assert.equal(ok, 2, results.map((r) => r.data.code ?? r.status).join(","));
    const now = await debtOf(a, id, b);
    assert.ok(now.pendingMinor + now.confirmedMinor <= now.amountMinor);
  });
});

describe("reminders", () => {
  test("only the payer, at most once per 24 hours per debt, logged", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 10 });
    const o = await debtOf(a, id, b);
    assert.equal((await api("POST", `/obligations/${o.id}/remind`, { token: a.token })).status, 200);
    const again = await api("POST", `/obligations/${o.id}/remind`, { token: a.token });
    assert.deepEqual([again.status, again.data.code], [429, "REMINDER_TOO_SOON"]);
    assert.ok(again.data.retryAt);
    await db.obligation.update({ where: { id: o.id }, data: { lastReminderAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    assert.equal((await api("POST", `/obligations/${o.id}/remind`, { token: a.token })).status, 200);
    assert.equal((await ledger(b, id)).data.events.filter((e) => e.type === "REMINDER_SENT").length, 2);
  });
});

describe("summaries, people, history, statements", () => {
  test("per-currency summary never mixes currencies; filters by status, role and person", async () => {
    const a = await user(), b = await user(), c = await user();
    await bill(a, [a, b], { price: 30, currency: "USD" });
    await bill(a, [a, c], { price: 3000, currency: "JPY" });
    const mine = await bill(b, [a, b], { price: 9, currency: "USD" }); // a owes b 4.50
    const s = (await api("GET", "/obligations/summary", { token: a.token })).data;
    assert.deepEqual(s.currencies.map((x) => x.currency), ["JPY", "USD"]);
    const usd = s.currencies.find((x) => x.currency === "USD");
    assert.deepEqual([usd.owedToMe.outstandingMinor, usd.iOwe.outstandingMinor, usd.netMinor, usd.minorPerUnit], [1500, 450, 1050, 100]);
    const jpy = s.currencies.find((x) => x.currency === "JPY");
    assert.deepEqual([jpy.owedToMe.outstandingMinor, jpy.minorPerUnit], [1500, 1]);
    assert.equal(usd.owedToMe.people[0].user.uniqueId, b.uniqueId);
    assert.ok(!JSON.stringify(s).includes("@example.test"));
    const onlyB = (await api("GET", `/obligations/summary?person=${encodeURIComponent(b.uniqueId)}`, { token: a.token })).data;
    assert.deepEqual(onlyB.currencies.map((x) => x.currency), ["USD"]);
    const credit = (await api("GET", "/obligations?role=creditor", { token: a.token })).data.obligations;
    assert.equal(credit.length, 2);
    const debts = (await api("GET", "/obligations?role=debtor&status=open", { token: a.token })).data.obligations;
    assert.deepEqual(debts.map((o) => o.bill.id), [mine.id]);
    assert.equal((await api("GET", "/obligations?status=WRONG", { token: a.token })).data.code, "VALIDATION");
    // settle a's debt to b and check the settled filter
    const o = debts[0];
    await pay(b, o.id); // b is the creditor here: records "received"
    assert.equal((await api("GET", "/obligations?status=settled", { token: a.token })).data.obligations.length, 1);
  });

  test("per-person detail and statement; strangers get 404", async () => {
    const a = await user(), b = await user(), stranger = await user();
    const { id } = await bill(a, [a, b], { price: 12 });
    const d = await api("GET", `/obligations/people/${encodeURIComponent(b.uniqueId)}`, { token: a.token });
    assert.equal(d.status, 200);
    assert.equal(d.data.obligations[0].bill.id, id);
    assert.equal(d.data.currencies[0].owedToMe.outstandingMinor, 600);
    assert.equal((await api("GET", `/obligations/people/${encodeURIComponent(stranger.uniqueId)}`, { token: a.token })).status, 404);
    const st = await api("GET", `/obligations/people/${encodeURIComponent(b.uniqueId)}/statement`, { token: a.token });
    assert.equal(st.status, 200);
    assert.match(st.data.legalNote, /Not a payment or tax document/);
    assert.ok(!JSON.stringify(st.data).includes("@example.test"));
  });

  test("bill statement: items and shares in minor units, legal note, no e-mails", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 12.5, name: "Cafe Roma" });
    const st = await api("GET", `/obligations/session/${id}/statement`, { token: b.token });
    assert.equal(st.status, 200);
    assert.equal(st.data.statementId, `S-${id}`);
    assert.equal(st.data.bill.name, "Cafe Roma");
    assert.deepEqual(st.data.items, [{ name: "Food", kind: null, totalMinor: 1250 }]);
    assert.equal(st.data.shares.reduce((s, x) => s + x.amountMinor, 0), 1250);
    assert.match(st.data.legalNote, /personal record-keeping/);
    assert.ok(!JSON.stringify(st.data).includes("@example.test"));
  });

  test("history shows the payment state and filters by it", async () => {
    const a = await user(), b = await user();
    const paid = await bill(a, [a, b], { price: 10, name: "Paid one" });
    await bill(a, [a, b], { price: 10, name: "Unpaid one" });
    const o = await debtOf(a, paid.id, b);
    await pay(a, o.id);
    const h = (await api("GET", "/sessions/history?all=true", { token: b.token })).data.entries;
    const byName = Object.fromEntries(h.map((e) => [e.sessionName, e.payment]));
    assert.equal(byName["Paid one"].status, "paid");
    assert.deepEqual([byName["Unpaid one"].status, byName["Unpaid one"].myBalanceMinor], ["unpaid", -500]);
    const f = (await api("GET", "/sessions/history?paymentStatus=unpaid", { token: b.token })).data.entries;
    assert.deepEqual(f.map((e) => e.sessionName), ["Unpaid one"]);
    assert.equal((await api("GET", "/sessions/history?paymentStatus=weird", { token: b.token })).status, 400);
  });
});

describe("integrity", () => {
  test("the audit log cannot be edited, and the database refuses overpayment even outside the API", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 10 });
    const ev = await db.obligationEvent.findFirst({ where: { sessionId: id } });
    await assert.rejects(() => db.obligationEvent.update({ where: { id: ev.id }, data: { note: "rewritten" } }), /append-only/);
    const o = await db.obligation.findFirst({ where: { sessionId: id } });
    await assert.rejects(() => db.obligation.update({ where: { id: o.id }, data: { confirmedMinor: o.amountMinor + 1 } }), /Obligation_paid_within_amount|check constraint/i);
  });

  test("deleting the debtor's account keeps the payer's record (as 'Deleted user') with its history", async () => {
    const a = await user(), b = await user();
    const { id } = await bill(a, [a, b], { price: 10 });
    const o = await debtOf(b, id, b);
    await pay(b, o.id, { amountMinor: 200 });
    assert.equal((await api("DELETE", "/users/me", { token: b.token, json: { password: PW } })).status, 200);
    const l = (await ledger(a, id)).data;
    assert.equal(l.obligations.length, 1);
    assert.equal(l.obligations[0].debtor.username, "Deleted user");
    assert.equal(l.obligations[0].pendingMinor, 200);
    assert.ok(l.events.some((e) => e.type === "PAYMENT_MARKED" && e.actor.username === "Deleted user"));
  });
});
