// Integration check of POST /sessions/finalize rounding. Needs a running backend (ALLOW_MOCK_OCR=1 or a Gemini key is NOT required:
// it creates the session via POST /sessions). Usage: node _audit_tests/finalize-rounding.mjs [baseUrl]
import assert from "node:assert/strict";
const B = process.argv[2] || "http://127.0.0.1:3001";
const post = (path, body, token) => fetch(B + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const rnd = Math.random().toString(36).slice(2, 8);
const people = [];
for (let i = 0; i < 7; i++) {
  const r = await post("/auth/register", { email: `r${rnd}${i}@t.io`, password: "Aa1!aaaa", username: `P${i}` });
  assert.equal(r.status, 200);
  people.push({ token: r.json.token, uniqueId: r.json.user.uniqueId, username: r.json.user.username });
}
const owner = people[0];
const cents = (x) => Math.round(x * 100);
const cases = [
  { name: "1.00 / 7", items: [{ price: 1, quantity: 1, n: 7 }] },
  { name: "100 / 3 + 19.99 / 6 + 0.01 / 3", items: [{ price: 100, quantity: 1, n: 3 }, { price: 19.99, quantity: 1, n: 6 }, { price: 0.01, quantity: 1, n: 3 }] },
  { name: "33.33 x3 / 7", items: [{ price: 33.33, quantity: 3, n: 7 }] },
  { name: "0.1 x3 / 3 (float)", items: [{ price: 0.1, quantity: 3, n: 3 }] },
  { name: "discount -10.00 / 3", items: [{ price: -10, quantity: 1, n: 3 }, { price: 25.5, quantity: 1, n: 3 }] },
];
for (const c of cases) {
  const s = await post("/sessions", {}, owner.token);
  const items = c.items.map((it, i) => ({ id: String(i + 1), name: `i${i}`, price: it.price, quantity: it.quantity, splitMode: "equal", assignedTo: people.slice(0, it.n).map((p) => p.uniqueId) }));
  const r = await post("/sessions/finalize", { sessionId: s.json.id, sessionName: c.name, currency: "USD", participants: people.map((p) => ({ uniqueId: p.uniqueId, username: p.username })), items }, owner.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const expected = c.items.reduce((a, it) => a + cents(it.price * it.quantity), 0);
  const byP = r.json.totals.byParticipant.reduce((a, p) => a + cents(p.amountOwed), 0);
  const byI = r.json.totals.byItem.reduce((a, it) => a + cents(it.total), 0);
  assert.equal(cents(r.json.totals.grandTotal), expected, `${c.name}: grandTotal`);
  assert.equal(byP, expected, `${c.name}: sum of participants`);
  assert.equal(byI, expected, `${c.name}: sum of items`);
  assert.ok(r.json.allocations.every((a) => !("shareMinor" in a)), "internal field leaked");
  console.log("ok", c.name, "total", r.json.totals.grandTotal, "shares", r.json.totals.byParticipant.map((p) => p.amountOwed).join(","));
}
