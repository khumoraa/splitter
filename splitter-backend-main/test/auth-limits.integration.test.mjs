// Brute-force protection on /auth: a real server with small limits against the separate "splitter_test" database.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { testDatabaseUrl, testRoot } from "../scripts/test-env.mjs";

const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let log = "";
const post = async (route, json) => {
  const res = await fetch(BASE + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  return { status: res.status, data: await res.json().catch(() => ({})), retryAfter: res.headers.get("retry-after") };
};

before(async () => {
  server = spawn(process.execPath, ["--loader", "ts-node/esm", "-r", "dotenv/config", "src/server.ts"], {
    cwd: testRoot,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: testDatabaseUrl(), JWT_SECRET: "integration-test-secret", NODE_ENV: "test", GEMINI_API_KEY: "", LOGIN_EMAIL_LIMIT: "3", LOGIN_IP_LIMIT: "6", REGISTER_LIMIT: "4", NODE_NO_WARNINGS: "1" },
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
after(() => server?.kill());

test("login: the 4th attempt for one e-mail is refused with RATE_LIMITED + Retry-After, other e-mails still work until the IP limit", async () => {
  const email = `rl_${crypto.randomBytes(3).toString("hex")}@example.test`;
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await post("/auth/login", { email, password: "wrong-Pass1!" })).status);
  assert.deepEqual(statuses.slice(0, 3).every((s) => s === 400 || s === 401), true, JSON.stringify(statuses));
  assert.equal(statuses[3], 429);
  const blocked = await post("/auth/login", { email, password: "wrong-Pass1!" });
  assert.equal(blocked.data.code, "RATE_LIMITED");
  assert.ok(Number(blocked.retryAfter) > 0);
  // another e-mail is not blocked by the first one's counter...
  assert.notEqual((await post("/auth/login", { email: `other_${crypto.randomBytes(3).toString("hex")}@example.test`, password: "x" })).status, 429);
  // ...but the per-IP counter (6) eventually stops everything from this address
  let last;
  for (let i = 0; i < 6; i++) last = await post("/auth/login", { email: `ip${i}_${crypto.randomBytes(2).toString("hex")}@example.test`, password: "x" });
  assert.equal(last.status, 429);
});

test("register: the 5th sign-up from one address in an hour is refused", async () => {
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomBytes(3).toString("hex");
    statuses.push((await post("/auth/register", { username: `rl${id}`, email: `rl_${id}@example.test`, password: "Aa1!testpw" })).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
});
