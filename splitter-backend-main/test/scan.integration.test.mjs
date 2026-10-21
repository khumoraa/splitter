// Black-box tests of the receipt-scan API with a MOCK AI (ALLOW_MOCK_SCAN=true, free). A real server runs on a free port
// against the separate "splitter_test" database.
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
const DAILY = 3;
let server;
let serverLog = "";
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

// A minimal JPEG header (SOF0 with width/height) followed by random bytes: enough for the header checks, unique per call.
function jpeg({ w = 900, h = 1300, bytes = 40_000 } = {}) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from(head), crypto.randomBytes(bytes)]);
}
const body = (buf, extra = {}) => ({ image: { mimeType: "image/jpeg", data: buf.toString("base64") }, ...extra });

async function api(method, route, { token, json, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (json !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(json); }
  const res = await fetch(BASE + route, { method, headers: h, body: payload });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const uid = () => crypto.randomBytes(4).toString("hex");
async function newUser() {
  const r = await api("POST", "/auth/register", { json: { username: `s${uid()}`, email: `s_${uid()}@example.test`, password: PW } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, user: r.data.user };
}
const scan = (token, buf, { mock = "ok", key, extra } = {}) =>
  api("POST", "/sessions/scan", { token, json: body(buf, extra), headers: { "X-Mock-Ai": mock, ...(key ? { "Idempotency-Key": key } : {}) } });
const quota = async (token) => (await api("GET", "/sessions/scan/quota", { token })).data;

before(async () => {
  server = spawn(process.execPath, ["--loader", "ts-node/esm", "-r", "dotenv/config", "src/server.ts"], {
    cwd: testRoot,
    env: {
      ...process.env, PORT: String(PORT), DATABASE_URL: testDatabaseUrl(), JWT_SECRET: "integration-test-secret", NODE_ENV: "test",
      GEMINI_API_KEY: "", ALLOW_MOCK_SCAN: "true", SCAN_LIMIT_DAILY: String(DAILY), SCAN_LIMIT_MONTHLY: "100",
      NODE_NO_WARNINGS: "1", REGISTER_LIMIT: "100000", LOGIN_IP_LIMIT: "100000", LOGIN_EMAIL_LIMIT: "100000",
    },
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

describe("auth and quota endpoint", () => {
  test("401 without a token", async () => {
    assert.equal((await api("GET", "/sessions/scan/quota")).status, 401);
    assert.equal((await api("POST", "/sessions/scan", { json: body(jpeg()) })).status, 401);
  });
  test("fresh user has the full allowance", async () => {
    const u = await newUser();
    const q = await quota(u.token);
    assert.equal(q.remaining, DAILY);
    assert.equal(q.limit, DAILY);
    assert.equal(q.resetAt, null);
  });
});

describe("recognition", () => {
  test("success: minor units, no session created, quota charged once, photo not stored", async () => {
    const u = await newUser();
    const r = await scan(u.token, jpeg());
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.cached, false);
    assert.equal(r.data.receipt.currency, "USD");
    assert.deepEqual(r.data.receipt.items[0], { name: "Latte", quantity: 2, unitMinor: 350, totalMinor: 700, confidence: 0.95 });
    assert.equal(r.data.receipt.taxMinor, 140);
    assert.equal(r.data.receipt.totalMinor, 1715);
    assert.deepEqual(r.data.receipt.warnings, []);
    assert.equal(r.data.quota.remaining, DAILY - 1);
    assert.equal(await db.session.count({ where: { creatorId: u.user.id } }), 0);
    const row = await db.scanRequest.findFirst({ where: { userId: u.user.id } });
    assert.ok(!JSON.stringify(row).includes("/9j/"), "no base64 image in the table");
  });

  test("total mismatch is reported with the difference, nothing is silently fixed", async () => {
    const u = await newUser();
    const r = await scan(u.token, jpeg(), { mock: "mismatch" });
    assert.equal(r.status, 200);
    assert.equal(r.data.receipt.totalMinor, 2000);
    assert.deepEqual(r.data.receipt.warnings, [{ code: "TOTAL_MISMATCH", expectedMinor: 2000, computedMinor: 1715, differenceMinor: 285 }]);
  });

  test("same photo again: cache, no AI call, no charge", async () => {
    const u = await newUser();
    const buf = jpeg();
    const first = await scan(u.token, buf);
    const calls = first.data._mockAiCalls;
    const second = await scan(u.token, buf);
    assert.equal(second.status, 200);
    assert.equal(second.data.cached, true);
    assert.equal(second.data._mockAiCalls, calls, "the AI must not be called again");
    assert.equal(second.data.quota.remaining, DAILY - 1);
    assert.deepEqual(second.data.receipt, first.data.receipt);
  });

  test("cache is per user: another user's identical photo is not served from someone else's result", async () => {
    const a = await newUser(), b = await newUser();
    const buf = jpeg();
    await scan(a.token, buf);
    const r = await scan(b.token, buf);
    assert.equal(r.data.cached, false);
  });
});

describe("idempotency", () => {
  test("replay with the same key: stored answer, no new AI call, no charge", async () => {
    const u = await newUser();
    const key = "idem-" + uid() + uid();
    const first = await scan(u.token, jpeg(), { key });
    const again = await scan(u.token, jpeg(), { key }); // even a different photo: the key wins
    assert.equal(again.status, 200);
    assert.equal(again.data.replayed, true);
    assert.equal(again.data._mockAiCalls, first.data._mockAiCalls);
    assert.deepEqual(again.data.receipt, first.data.receipt);
    assert.equal((await quota(u.token)).remaining, DAILY - 1);
  });

  test("double tap (parallel, same key): exactly one paid call", async () => {
    const u = await newUser();
    const key = "dbl-" + uid() + uid();
    const buf = jpeg();
    const [x, y] = await Promise.all([scan(u.token, buf, { key }), scan(u.token, buf, { key })]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.equal((await quota(u.token)).remaining, DAILY - 1);
    assert.equal(await db.scanRequest.count({ where: { userId: u.user.id, charged: true } }), 1);
  });

  test("malformed key is rejected", async () => {
    const u = await newUser();
    const r = await scan(u.token, jpeg(), { key: "short" });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, "INVALID_REQUEST");
  });
});

describe("invalid input never costs quota", () => {
  test("INVALID_IMAGE reasons, IMAGE_TOO_LARGE, missing image", async () => {
    const u = await newUser();
    const check = async (buf, status, code, reason) => {
      const r = await scan(u.token, buf);
      assert.equal(r.status, status, JSON.stringify(r.data));
      assert.equal(r.data.code, code);
      if (reason) assert.equal(r.data.reason, reason);
    };
    await check(crypto.randomBytes(5000), 422, "INVALID_IMAGE", "UNSUPPORTED_TYPE");
    await check(Buffer.from("GIF89a" + "x".repeat(5000)), 422, "INVALID_IMAGE", "UNSUPPORTED_TYPE");
    await check(jpeg({ w: 200, h: 300 }), 422, "INVALID_IMAGE", "TOO_SMALL");
    await check(jpeg({ w: 1280, h: 960, bytes: 2000 }), 422, "INVALID_IMAGE", "BLANK");
    await check(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(5000)]), 422, "INVALID_IMAGE", "CORRUPT");
    await check(jpeg({ bytes: 3_100_000 }), 413, "IMAGE_TOO_LARGE");
    const noImage = await api("POST", "/sessions/scan", { token: u.token, json: {} });
    assert.equal(noImage.status, 400);
    assert.equal(noImage.data.code, "INVALID_REQUEST");
    assert.equal((await quota(u.token)).remaining, DAILY);
    assert.equal(await db.scanRequest.count({ where: { userId: u.user.id } }), 0);
  });
});

describe("AI failures", () => {
  test("AI_UNAVAILABLE is not charged and can be retried", async () => {
    const u = await newUser();
    const r = await scan(u.token, jpeg(), { mock: "unavailable" });
    assert.equal(r.status, 503);
    assert.equal(r.data.code, "AI_UNAVAILABLE");
    assert.equal((await quota(u.token)).remaining, DAILY);
  });
  test("NOT_A_RECEIPT and PARSE_FAILED reached the model: charged", async () => {
    const u = await newUser();
    const a = await scan(u.token, jpeg(), { mock: "not_receipt" });
    assert.equal(a.status, 422);
    assert.equal(a.data.code, "NOT_A_RECEIPT");
    const b = await scan(u.token, jpeg(), { mock: "garbage" });
    assert.equal(b.status, 502);
    assert.equal(b.data.code, "PARSE_FAILED");
    assert.equal((await quota(u.token)).remaining, DAILY - 2);
  });
});

describe("quota limits", () => {
  test("within, boundary, exceeded (429 + resetAt), cache still free when exhausted", async () => {
    const u = await newUser();
    const bufs = [jpeg(), jpeg(), jpeg()];
    for (let i = 0; i < DAILY; i++) {
      const r = await scan(u.token, bufs[i]);
      assert.equal(r.status, 200);
      assert.equal(r.data.quota.remaining, DAILY - 1 - i);
    }
    const q = await quota(u.token);
    assert.equal(q.remaining, 0);
    assert.ok(q.resetAt && new Date(q.resetAt) > new Date());
    const blocked = await scan(u.token, jpeg());
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.code, "QUOTA_EXCEEDED");
    assert.equal(blocked.data.resetAt, q.resetAt);
    const cached = await scan(u.token, bufs[0]);
    assert.equal(cached.status, 200);
    assert.equal(cached.data.cached, true);
  });

  test("reset: when the old charges leave the window, the allowance returns", async () => {
    const u = await newUser();
    for (let i = 0; i < DAILY; i++) await scan(u.token, jpeg());
    assert.equal((await quota(u.token)).remaining, 0);
    await db.scanRequest.updateMany({ where: { userId: u.user.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    const q = await quota(u.token);
    assert.equal(q.remaining, DAILY);
    assert.equal((await scan(u.token, jpeg())).status, 200);
  });
});

describe("manual path (no AI, no quota)", () => {
  const person = (u) => ({ uniqueId: u.user.uniqueId, username: u.user.username });
  test("create + finalize works and does not touch the quota; invalid bills are rejected", async () => {
    const u = await newUser();
    const s = await api("POST", "/sessions", { token: u.token, json: {} });
    assert.equal(s.status, 200);
    const items = [{ id: "m1", name: "Tea", quantity: 2, price: 3.5, assignedTo: [u.user.uniqueId] }];
    const fin = await api("POST", "/sessions/finalize", { token: u.token, json: { sessionId: s.data.id, sessionName: "Manual", currency: "USD", participants: [person(u)], items } });
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    assert.equal((await quota(u.token)).remaining, DAILY);

    const bad = async (patch) => {
      const r = await api("POST", "/sessions/finalize", { token: u.token, json: { sessionId: s.data.id, sessionName: "x", currency: "USD", participants: [person(u)], items: [{ ...items[0], ...patch }] } });
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.equal(r.data.code, "INVALID_ITEMS");
    };
    await bad({ name: "" });
    await bad({ price: -5 });
    await bad({ quantity: 0 });
    await bad({ quantity: 1.5 });
    const many = await api("POST", "/sessions/finalize", { token: u.token, json: { sessionId: s.data.id, sessionName: "x", currency: "USD", participants: [person(u)], items: Array.from({ length: 201 }, (_, i) => ({ ...items[0], id: "i" + i })) } });
    assert.equal(many.status, 400);
    assert.equal((await api("POST", "/sessions", { token: u.token, json: { total: -1 } })).status, 400);
    assert.equal((await api("POST", "/sessions", { token: u.token, json: { serviceFee: "abc" } })).status, 400);
  });
});

describe("account deletion", () => {
  test("scan records are removed with the account", async () => {
    const u = await newUser();
    await scan(u.token, jpeg());
    assert.equal(await db.scanRequest.count({ where: { userId: u.user.id } }), 1);
    const del = await api("DELETE", "/users/me", { token: u.token, json: { password: PW } });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.equal(await db.scanRequest.count({ where: { userId: u.user.id } }), 0);
  });
});
