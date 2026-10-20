import test from "node:test";
import assert from "node:assert/strict";
import { passwordIssue } from "./password.ts";

// Mirror of backend isStrongPassword (splitter-backend/src/utils/validation.ts)
const serverAccepts = (pw) => pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);

test("reports the first problem as an i18n key", () => {
  assert.equal(passwordIssue("abcdef"), "auth.errors.passwordLength");
  assert.equal(passwordIssue("abcdefgh"), "auth.errors.passwordUpper");
  assert.equal(passwordIssue("ABCDEFGH"), "auth.errors.passwordLower");
  assert.equal(passwordIssue("Abcdefgh"), "auth.errors.passwordDigit");
  assert.equal(passwordIssue("Abcdefg1"), "auth.errors.passwordSpecial");
  assert.equal(passwordIssue("Abcdef1!"), null);
});

test("accepts exactly what the server accepts", () => {
  const samples = ["", "short1!A", "Aa1!aaaa", "aA1!aaaa", "AAAAAAA1!", "aaaaaaa1!", "Aaaaaaaa!", "Aaaaaaa1", "Aa1 aaaa", "Пароль1!aA", "Aa1!ааааа", "        ", "Aa!1Aa!1Aa!1"];
  for (const pw of samples) assert.equal(passwordIssue(pw) === null, serverAccepts(pw), JSON.stringify(pw));
});
