import test from "node:test";
import assert from "node:assert/strict";
import { validateUsername, validateEmail, validatePasswordChange } from "./validation.ts";
// the SERVER's rules: the two implementations must agree
import { checkUsername } from "../../../../../splitter-backend-main/src/utils/username.ts";

const NAMES = ["Alice", "  Bob   Marley ", "Хумора", "田中太郎", "O'Brien", "a_b-c.d", "Jo", "a", "", "   ", "x".repeat(32), "x".repeat(33), "<b>x</b>", "a\u0000b", "ab​c", "‮evil", "hello 😀", "-abc", ".abc", "a/b", "a@b", "ё", "ab"];

test("username: the client accepts and rejects exactly what the server does", () => {
  for (const input of NAMES) {
    const client = validateUsername(input);
    const server = checkUsername(input);
    assert.equal(client.ok, server.ok, JSON.stringify(input));
    if (client.ok) assert.equal(client.value, server.value, JSON.stringify(input));
    else assert.equal(client.key, `profile.errors.username${server.reason[0].toUpperCase()}${server.reason.slice(1)}`, JSON.stringify(input));
  }
});

test("email: trimmed, lower-cased, format checked", () => {
  assert.deepEqual(validateEmail("  Me@Example.COM "), { ok: true, value: "me@example.com" });
  assert.equal(validateEmail("").key, "profile.errors.emailRequired");
  for (const bad of ["plain", "a@b", "a b@c.de", "@x.io", "a@@b.io", `${"x".repeat(250)}@b.io`]) assert.equal(validateEmail(bad).ok, false, bad);
});

test("password change: first problem wins, same order as the form", () => {
  const ok = { current: "Old1!password", next: "New2@password", confirm: "New2@password" };
  assert.equal(validatePasswordChange(ok), null);
  assert.equal(validatePasswordChange({ ...ok, current: "" }), "profile.errors.currentPasswordRequired");
  assert.equal(validatePasswordChange({ ...ok, next: "short", confirm: "short" }), "auth.errors.passwordLength");
  assert.equal(validatePasswordChange({ ...ok, next: "nouppercase1!", confirm: "nouppercase1!" }), "auth.errors.passwordUpper");
  assert.equal(validatePasswordChange({ ...ok, confirm: "Different3#pw" }), "profile.errors.passwordMismatch");
  assert.equal(validatePasswordChange({ current: "Same1!password", next: "Same1!password", confirm: "Same1!password" }), "profile.errors.samePassword");
});
