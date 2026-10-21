import test from "node:test";
import assert from "node:assert/strict";
import { checkUsername } from "./username.ts";

test("accepts normal names in several scripts and normalises whitespace", () => {
  for (const [input, expected] of [["Alice", "Alice"], ["  Bob   Marley ", "Bob Marley"], ["Хумора", "Хумора"], ["田中太郎", "田中太郎"], ["O'Brien", "O'Brien"], ["a_b-c.d", "a_b-c.d"], ["Jo", "Jo"], ["x".repeat(32), "x".repeat(32)]]) {
    assert.deepEqual(checkUsername(input), { ok: true, value: expected }, input);
  }
});

test("rejects empty, too short/long, and non-string input", () => {
  assert.deepEqual(checkUsername("   "), { ok: false, reason: "required" });
  assert.deepEqual(checkUsername(undefined), { ok: false, reason: "required" });
  assert.deepEqual(checkUsername(42), { ok: false, reason: "required" });
  assert.deepEqual(checkUsername("a"), { ok: false, reason: "length" });
  assert.deepEqual(checkUsername("x".repeat(33)), { ok: false, reason: "length" });
});

test("rejects markup, control/invisible characters, emoji and leading separators", () => {
  for (const bad of ["<script>", "a\u0000b", "ab​c", "‮evil", "hello 😀", "-abc", ".abc", "_ab", "a/b", "a@b", "a;b"]) {
    const r = checkUsername(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});
