import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProblems } from "./check-i18n.mjs";

function fixture(files, locales) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-check-"));
  fs.mkdirSync(path.join(dir, "src/shared/config/locales"), { recursive: true });
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  for (const [l, content] of Object.entries(locales)) fs.writeFileSync(path.join(dir, `src/shared/config/locales/${l}.json`), JSON.stringify(content));
  for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), content);
  return dir;
}

test("the real project: every used key exists in en, ja and uz and the files have identical keys", () => {
  const r = findProblems();
  assert.deepEqual(r.missing, [], JSON.stringify(r.missing, null, 1));
  assert.deepEqual(r.parity, [], JSON.stringify(r.parity, null, 1));
  assert.ok(r.usedCount > 100, "scanner found suspiciously few keys: " + r.usedCount);
});

test("the checker really reports a key missing in one language (and a parity gap)", () => {
  const dir = fixture(
    { "app/a.tsx": "t('auth.ok'); t(\"auth.onlyEn\", 'x'); const k = 'auth.fromData'; t('count.items', { count: 2 });" },
    {
      en: { auth: { ok: "ok", onlyEn: "x", fromData: "d" }, count: { items_one: "1", items_other: "n" } },
      ja: { auth: { ok: "ok", fromData: "d" }, count: { items_other: "n" } },
      uz: { auth: { ok: "ok", onlyEn: "x" }, count: { items_one: "1", items_other: "n" } },
    }
  );
  const r = findProblems(dir);
  const miss = r.missing.map((m) => `${m.lang}:${m.key}`).sort();
  assert.deepEqual(miss, ["ja:auth.onlyEn", "uz:auth.fromData"]); // plural base 'count.items' is satisfied by _one/_other
  assert.ok(r.parity.some((p) => p.key === "auth.onlyEn" && p.missingIn === "ja"));
});
