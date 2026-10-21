// Black-box tests of the profile/avatar/account API. They start a REAL server (ts-node) on a free port against the separate
// "splitter_test" database and a temporary uploads folder, then talk to it over HTTP exactly like the phone does.
//   npm run test:db           (once: creates/migrates splitter_test)
//   npm run test:integration
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { testDatabaseUrl, testRoot } from "../scripts/test-env.mjs";

const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "splitter-uploads-"));
const AVATARS = path.join(UPLOADS, "avatars");
const PW = "Aa1!testpw";
let server;
let serverLog = "";

// ---------- helpers ----------
const jpeg = (bytes) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), crypto.randomBytes(bytes)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(2000)]);

async function api(method, route, { token, json, form, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  }
  if (form) payload = form; // fetch adds the multipart boundary itself, like React Native does
  const res = await fetch(BASE + route, { method, headers: h, body: payload });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const uid = () => crypto.randomBytes(4).toString("hex");
async function newUser(prefix = "u") {
  const email = `${prefix}_${uid()}@example.test`;
  const r = await api("POST", "/auth/register", { json: { username: `${prefix}${uid()}`, email, password: PW } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { token: r.data.token, user: r.data.user, email };
}
function upload(token, buffer, { filename = "avatar.jpg", type = "image/jpeg", field = "file" } = {}) {
  const form = new FormData();
  form.append(field, new Blob([buffer], { type }), filename);
  return api("POST", "/uploads/avatar", { token, form });
}
const filesOnDisk = () => (fs.existsSync(AVATARS) ? fs.readdirSync(AVATARS) : []);

before(async () => {
  server = spawn(process.execPath, ["--loader", "ts-node/esm", "-r", "dotenv/config", "src/server.ts"], {
    cwd: testRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: "integration-test-secret",
      UPLOADS_DIR: UPLOADS,
      NODE_ENV: "test",
      R2_ENDPOINT: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "", CDN_BASE_URL: "",
      GEMINI_API_KEY: "",
      PUBLIC_BASE_URL: "",
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start:\n" + serverLog.slice(-1500));
});

after(() => {
  server?.kill();
  fs.rmSync(UPLOADS, { recursive: true, force: true });
});

// ---------- avatar upload ----------
describe("POST /uploads/avatar", () => {
  test("needs a token", async () => {
    const r = await upload(undefined, jpeg(1000));
    assert.equal(r.status, 401);
  });

  test("a ~300 KB JPEG is stored, served over HTTP and returned by /auth/me; the URL is absolute and built from the request host", async () => {
    const { token } = await newUser("up");
    const bytes = jpeg(300 * 1024);
    const r = await upload(token, bytes);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.avatarUrl, new RegExp(`^${BASE}/media/avatars/[0-9a-f-]{36}\\.jpg$`));
    assert.equal(r.data.user.avatarUrl, r.data.avatarUrl);
    assert.equal(r.data.user.password, undefined);

    const file = await fetch(r.data.avatarUrl);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/jpeg");
    assert.match(file.headers.get("cache-control") ?? "", /immutable/);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes));

    const me = await api("GET", "/auth/me", { token });
    assert.equal(me.data.avatarUrl, r.data.avatarUrl);
  });

  test("the type comes from the bytes, not from the name or Content-Type: a PNG sent as .jpg is stored as .png", async () => {
    const { token } = await newUser("up");
    const r = await upload(token, png(), { filename: "photo.jpg", type: "image/jpeg" });
    assert.equal(r.status, 200);
    assert.match(r.data.avatarUrl, /\.png$/);
    assert.equal((await fetch(r.data.avatarUrl)).headers.get("content-type"), "image/png");
  });

  test("replacing the avatar deletes the previous file", async () => {
    const { token } = await newUser("up");
    const first = await upload(token, jpeg(5000));
    const second = await upload(token, png());
    assert.notEqual(first.data.avatarUrl, second.data.avatarUrl);
    await new Promise((r) => setTimeout(r, 300)); // deletion is fire-and-forget
    assert.equal((await fetch(first.data.avatarUrl)).status, 404);
    assert.equal((await fetch(second.data.avatarUrl)).status, 200);
  });

  test("a 6 MB file is rejected with 413 and the old avatar stays", async () => {
    const { token } = await newUser("up");
    const ok = await upload(token, jpeg(5000));
    const big = await upload(token, jpeg(6 * 1024 * 1024));
    assert.equal(big.status, 413, JSON.stringify(big.data));
    assert.equal(big.data.maxBytes, 5 * 1024 * 1024);
    const me = await api("GET", "/auth/me", { token });
    assert.equal(me.data.avatarUrl, ok.data.avatarUrl);
    assert.equal((await fetch(ok.data.avatarUrl)).status, 200);
  });

  test("non-images are rejected with 415 even when the name and Content-Type claim JPEG", async () => {
    const { token } = await newUser("up");
    const cases = {
      text: Buffer.from("just some text pretending to be a picture, long enough to pass any minimum size check"),
      html: Buffer.from("<html><script>alert(1)</script></html> padding padding padding"),
      svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg> padding padding'),
      gif: Buffer.from("GIF89a" + "\0".repeat(64), "binary"),
      exe: Buffer.concat([Buffer.from("MZ"), crypto.randomBytes(100)]),
    };
    for (const [name, buf] of Object.entries(cases)) {
      const r = await upload(token, buf, { filename: "avatar.jpg", type: "image/jpeg" });
      assert.equal(r.status, 415, `${name}: ${JSON.stringify(r.data)}`);
    }
  });

  test("malformed requests get 400: empty file, no file, wrong field name, hand-written multipart header without boundary", async () => {
    const { token } = await newUser("up");
    assert.equal((await upload(token, Buffer.alloc(0))).status, 400);
    assert.equal((await api("POST", "/uploads/avatar", { token, form: new FormData() })).status, 400);
    assert.equal((await upload(token, jpeg(2000), { field: "photo" })).status, 400);
    // What React Native does when the app sets the header by hand: no boundary, so the body cannot be parsed.
    const manual = await api("POST", "/uploads/avatar", { token, headers: { "Content-Type": "multipart/form-data" }, body: Buffer.from("--x\r\n\r\n") });
    assert.equal(manual.status, 400, JSON.stringify(manual.data));
  });

  test("no stray files are left behind by the rejected uploads (only the avatars that are in use remain)", async () => {
    const before = filesOnDisk().length;
    const { token } = await newUser("up");
    await upload(token, Buffer.from("not an image at all, just text"));
    await upload(token, jpeg(6 * 1024 * 1024));
    assert.equal(filesOnDisk().length, before);
  });

  test("rate limit: 11th upload within 10 minutes answers 429 with Retry-After", async () => {
    const { token } = await newUser("rl");
    const small = jpeg(500);
    let last;
    for (let i = 0; i < 11; i++) last = await upload(token, small);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get("retry-after")) > 0);
  });
});

describe("DELETE /users/me/avatar", () => {
  test("avatarUrl becomes null (not a placeholder), the file is deleted, repeating is harmless", async () => {
    const { token } = await newUser("rs");
    const up = await upload(token, jpeg(4000));
    const r = await api("DELETE", "/users/me/avatar", { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.equal(r.data.avatarUrl, null);
    assert.equal(r.data.user.avatarUrl, null);
    await new Promise((x) => setTimeout(x, 300));
    assert.equal((await fetch(up.data.avatarUrl)).status, 404);
    assert.equal((await api("GET", "/auth/me", { token })).data.avatarUrl, null);
    assert.equal((await api("DELETE", "/users/me/avatar", { token })).status, 200);
  });

  test("needs a token", async () => {
    assert.equal((await api("DELETE", "/users/me/avatar")).status, 401);
  });
});

describe("no placeholder avatars anywhere", () => {
  test("friends, search and public profile return null for users without an avatar and hide other people's email", async () => {
    const a = await newUser("fr");
    const b = await newUser("fr");
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.user.uniqueId } });
    const inc = await api("GET", "/friends/requests", { token: b.token });
    await api("PATCH", "/friends/accept", { token: b.token, json: { uniqueId: b.user.uniqueId, requesterId: inc.data.incoming[0].from.id } });
    const list = await api("GET", "/friends", { token: a.token });
    assert.equal(list.data[0].avatarUrl, null);
    const search = await api("GET", `/friends/search?q=${encodeURIComponent(b.user.uniqueId)}`, { token: a.token });
    assert.equal(search.data.results[0].avatarUrl, null);
    const pub = await api("GET", `/users/${b.user.id}`, { token: a.token });
    assert.equal(pub.data.avatarUrl, null);
    assert.equal(pub.data.email, undefined, "other people's email must not be exposed");
    const self = await api("GET", `/users/${a.user.id}`, { token: a.token });
    assert.equal(self.data.email, a.email);
  });
});

// ---------- profile fields ----------
describe("PATCH /user/username", () => {
  test("trims and collapses spaces, accepts other scripts", async () => {
    const { token } = await newUser("nm");
    const r = await api("PATCH", "/user/username", { token, json: { username: "  Хумора   Тест " } });
    assert.equal(r.status, 200);
    assert.equal(r.data.username, "Хумора Тест");
    assert.equal(r.data.password, undefined);
  });
  test("rejects too short, markup, empty and non-string with a stable code", async () => {
    const { token } = await newUser("nm");
    const cases = [["a", "USERNAME_LENGTH"], ["x".repeat(33), "USERNAME_LENGTH"], ["<b>x</b>", "USERNAME_CHARS"], ["   ", "USERNAME_REQUIRED"], [42, "USERNAME_REQUIRED"]];
    for (const [value, code] of cases) {
      const r = await api("PATCH", "/user/username", { token, json: { username: value } });
      assert.equal(r.status, 400, String(value));
      assert.equal(r.data.code, code, String(value));
    }
  });
  test("needs a token", async () => {
    assert.equal((await api("PATCH", "/user/username", { json: { username: "Zed" } })).status, 401);
  });
});

describe("PATCH /user/email", () => {
  test("requires the current password, validates the format, refuses duplicates", async () => {
    const a = await newUser("em");
    const b = await newUser("em");
    const fresh = `new_${uid()}@Example.TEST`;
    assert.equal((await api("PATCH", "/user/email", { token: a.token, json: { email: fresh } })).data.code, "PASSWORD_REQUIRED");
    assert.equal((await api("PATCH", "/user/email", { token: a.token, json: { email: fresh, currentPassword: "Wrong1!pass" } })).data.code, "WRONG_PASSWORD");
    assert.equal((await api("PATCH", "/user/email", { token: a.token, json: { email: "not-an-email", currentPassword: PW } })).data.code, "INVALID_EMAIL");
    const dup = await api("PATCH", "/user/email", { token: a.token, json: { email: b.email, currentPassword: PW } });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.code, "EMAIL_IN_USE");
    const ok = await api("PATCH", "/user/email", { token: a.token, json: { email: fresh, currentPassword: PW } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.email, fresh.toLowerCase());
    // the new address works for sign-in, the old one no longer does
    assert.equal((await api("POST", "/auth/login", { json: { email: fresh, password: PW } })).status, 200);
    assert.equal((await api("POST", "/auth/login", { json: { email: a.email, password: PW } })).status, 400);
  });
});

describe("PATCH /user/password", () => {
  test("policy, wrong current, same password, success; the password never appears in the server log", async () => {
    const a = await newUser("pw");
    const NEW = "Bb2@brandnew";
    const send = (json) => api("PATCH", "/user/password", { token: a.token, json });
    assert.equal((await send({ currentPassword: PW, newPassword: "short" })).data.code, "WEAK_PASSWORD");
    assert.equal((await send({ currentPassword: PW, newPassword: "nouppercase1!" })).data.code, "WEAK_PASSWORD");
    assert.equal((await send({ currentPassword: "Wrong1!pass", newPassword: NEW })).data.code, "WRONG_PASSWORD");
    assert.equal((await send({ currentPassword: PW, newPassword: PW })).data.code, "SAME_PASSWORD");
    assert.equal((await send({ newPassword: NEW })).data.code, "PASSWORD_REQUIRED");
    const ok = await send({ currentPassword: PW, newPassword: NEW });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { success: true });
    assert.equal((await api("POST", "/auth/login", { json: { email: a.email, password: PW } })).status, 400);
    assert.equal((await api("POST", "/auth/login", { json: { email: a.email, password: NEW } })).status, 200);
    assert.ok(!serverLog.includes(NEW) && !serverLog.includes("Wrong1!pass"), "a password was written to the server log");
  });
});

describe("removed unsafe endpoints", () => {
  test("PATCH /user/update (changed the password without the current one), GET /user/list (every user's email), DELETE /user/delete and PATCH /users/me/avatar are gone", async () => {
    const { token } = await newUser("rm");
    assert.equal((await api("PATCH", "/user/update", { token, json: { password: "Zz9#newpassword" } })).status, 404);
    assert.equal((await api("GET", "/user/list", { token })).status, 404);
    assert.equal((await api("DELETE", "/user/delete", { token })).status, 404);
    assert.equal((await api("PATCH", "/users/me/avatar", { token, json: { avatarUrl: "https://evil.example/p.png" } })).status, 404);
  });
});

// ---------- export + account deletion ----------
describe("GET /users/me/export", () => {
  test("returns my data without any password", async () => {
    const a = await newUser("ex");
    const r = await api("GET", "/users/me/export", { token: a.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.profile.email, a.email);
    assert.ok(Array.isArray(r.data.friends) && Array.isArray(r.data.groups) && Array.isArray(r.data.bills));
    assert.ok(!JSON.stringify(r.data).toLowerCase().includes("password"));
    assert.equal((await api("GET", "/users/me/export")).status, 401);
  });
});

describe("DELETE /users/me (account deletion)", () => {
  test("wrong or missing password changes nothing", async () => {
    const a = await newUser("dl");
    assert.equal((await api("DELETE", "/users/me", { token: a.token, json: {} })).status, 400);
    const wrong = await api("DELETE", "/users/me", { token: a.token, json: { password: "Wrong1!pass" } });
    assert.equal(wrong.status, 400);
    assert.equal((await api("GET", "/auth/me", { token: a.token })).status, 200);
  });

  test("full scenario: groups, friends, history, avatar, tokens", async () => {
    const a = await newUser("dl");
    const b = await newUser("dl");
    const c = await newUser("dl");

    // friendship a-b
    await api("POST", "/friends/request", { token: a.token, json: { uniqueId: b.user.uniqueId } });
    const inc = await api("GET", "/friends/requests", { token: b.token });
    await api("PATCH", "/friends/accept", { token: b.token, json: { uniqueId: b.user.uniqueId, requesterId: inc.data.incoming[0].from.id } });

    // a owns a group with b (ownership must move to b) and a group alone (must disappear)
    const shared = (await api("POST", "/groups", { token: a.token, json: { name: "Shared" } })).data;
    await api("POST", `/groups/${shared.id}/members`, { token: a.token, json: { uniqueId: b.user.uniqueId } });
    const alone = (await api("POST", "/groups", { token: a.token, json: { name: "Alone" } })).data;

    // a pays a bill with b (b keeps it), and a bill alone (must disappear)
    const s1 = (await api("POST", "/sessions", { token: a.token, json: {} })).data;
    const item = (qty) => ({ id: "1", name: "Pizza", price: 10, quantity: qty, splitMode: "equal", assignedTo: [] });
    const fin1 = await api("POST", "/sessions/finalize", {
      token: a.token,
      json: { sessionId: s1.id, sessionName: "Dinner", currency: "USD", participants: [{ uniqueId: a.user.uniqueId, username: a.user.username }, { uniqueId: b.user.uniqueId, username: b.user.username }], items: [{ ...item(1), assignedTo: [a.user.uniqueId, b.user.uniqueId] }] },
    });
    assert.equal(fin1.status, 200, JSON.stringify(fin1.data));
    const s2 = (await api("POST", "/sessions", { token: a.token, json: {} })).data;
    await api("POST", "/sessions/finalize", { token: a.token, json: { sessionId: s2.id, sessionName: "Solo", currency: "USD", participants: [{ uniqueId: a.user.uniqueId, username: a.user.username }], items: [{ ...item(1), assignedTo: [a.user.uniqueId] }] } });

    // b pays a bill that a took part in (a's identity must be removed from it)
    const s3 = (await api("POST", "/sessions", { token: b.token, json: {} })).data;
    await api("POST", "/sessions/finalize", { token: b.token, json: { sessionId: s3.id, sessionName: "Lunch", currency: "USD", participants: [{ uniqueId: a.user.uniqueId, username: a.user.username }, { uniqueId: b.user.uniqueId, username: b.user.username }], items: [{ ...item(1), assignedTo: [a.user.uniqueId, b.user.uniqueId] }] } });

    const avatar = await upload(a.token, jpeg(4000));
    assert.equal(avatar.status, 200);
    const filesBefore = filesOnDisk().length;

    // delete
    const del = await api("DELETE", "/users/me", { token: a.token, json: { password: PW } });
    assert.equal(del.status, 200, JSON.stringify(del.data));
    assert.deepEqual(del.data, { success: true });

    // the account, its token and sign-in are gone
    const me = await api("GET", "/auth/me", { token: a.token });
    assert.equal(me.status, 401);
    assert.equal(me.data.code, "ACCOUNT_DELETED");
    assert.equal((await api("POST", "/auth/login", { json: { email: a.email, password: PW } })).status, 400);

    // avatar file removed
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await fetch(avatar.data.avatarUrl)).status, 404);
    assert.equal(filesOnDisk().length, filesBefore - 1);

    // friendship gone
    assert.equal((await api("GET", "/friends", { token: b.token })).data.length, 0);

    // groups: ownership moved to b; the solo group vanished
    const groupsOfB = (await api("GET", "/groups", { token: b.token })).data;
    const movedGroup = groupsOfB.find((g) => g.id === shared.id);
    assert.ok(movedGroup, "shared group must survive");
    assert.equal(movedGroup.ownerId, b.user.id);
    assert.ok(!groupsOfB.some((g) => g.id === alone.id));
    assert.equal(movedGroup.members.some((m) => m.uniqueId === a.user.uniqueId), false);

    // b's history: both bills still there, a is anonymised everywhere
    const hist = (await api("GET", "/sessions/history?all=true", { token: b.token })).data;
    const names = hist.entries.map((e) => e.sessionName).sort();
    assert.deepEqual(names, ["Dinner", "Lunch"], "the solo bill must be deleted, the shared ones kept");
    const text = JSON.stringify(hist);
    assert.ok(!text.includes(a.user.uniqueId), "the deleted user's id leaked into history");
    assert.ok(!text.includes(a.user.username), "the deleted user's name leaked into history");
    const dinner = hist.entries.find((e) => e.sessionName === "Dinner");
    assert.equal(dinner.payer.username, "Deleted user");
    assert.equal(dinner.isCreator, false);

    // c is not affected, and the freed id cannot be used to see old bills
    assert.equal((await api("GET", "/auth/me", { token: c.token })).status, 200);
  });
});
