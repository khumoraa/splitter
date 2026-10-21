import test from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "./auth-errors.ts";

// t() that returns the key, so the tests check WHICH message is chosen, not its wording
const t = (key) => key;
const http = (status, message = "English server text") => ({ kind: "http", status, message });

test("register: duplicate email (409) and invalid data (400)", () => {
  assert.equal(authErrorMessage(http(409, "Email already in use"), "register", t), "auth.errors.emailInUse");
  assert.equal(authErrorMessage(http(400, "Password must be at least 8 characters…"), "register", t), "auth.errors.registerInvalid");
});

test("login: wrong password / unknown email is 400 on this server", () => {
  assert.equal(authErrorMessage(http(400, "Invalid email or password"), "login", t), "auth.errors.invalidCredentials");
  // a 409 is not a login outcome
  assert.equal(authErrorMessage(http(409), "login", t), "auth.loginError");
});

test("network / timeout use the already translated message from apiClient", () => {
  assert.equal(authErrorMessage({ kind: "network", message: "Нет соединения" }, "login", t), "Нет соединения");
  assert.equal(authErrorMessage({ kind: "timeout", message: "Timeout!" }, "register", t), "Timeout!");
  assert.equal(authErrorMessage({ kind: "network" }, "login", t), "errors.network");
});

test("5xx and unknown failures fall back to generic translated messages", () => {
  assert.equal(authErrorMessage(http(500, "Server error"), "login", t), "errors.server");
  assert.equal(authErrorMessage(http(503), "register", t), "errors.server");
  assert.equal(authErrorMessage(new Error("boom"), "login", t), "auth.loginError");
  assert.equal(authErrorMessage(undefined, "register", t), "auth.registerError");
  assert.equal(authErrorMessage("oops", "register", t), "auth.registerError");
});

test("the server's English text is never shown", () => {
  for (const flow of ["login", "register"]) for (const s of [400, 401, 403, 404, 409, 415, 500]) {
    assert.notEqual(authErrorMessage(http(s, "English server text"), flow, t), "English server text", `${flow} ${s}`);
  }
});
