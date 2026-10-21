import test from "node:test";
import assert from "node:assert/strict";
import { createProfileActions } from "./profile-actions.ts";
import { profileErrorKey } from "./profile-errors.ts";

const USER = { id: 1, email: "a@b.io", username: "Alice", uniqueId: "#1111", avatarUrl: null };
const http = (status, code, kind = "http") => ({ kind, status, code });

function setup(apiOverrides = {}, user = USER) {
  const calls = [];
  const state = { user: { ...user }, loggedOut: false };
  const api = {
    updateUsername: async (u) => { calls.push(["updateUsername", u]); return { ...state.user, username: u }; },
    updateEmail: async (e, p) => { calls.push(["updateEmail", e, p]); return { ...state.user, email: e }; },
    changePassword: async (c, n) => { calls.push(["changePassword", c, n]); },
    uploadAvatar: async (f, onP) => { calls.push(["uploadAvatar", f.name]); onP?.(50); onP?.(100); return { ...state.user, avatarUrl: "http://x/media/avatars/a.jpg" }; },
    removeAvatar: async () => { calls.push(["removeAvatar"]); return { ...state.user, avatarUrl: null }; },
    deleteAccount: async (p) => { calls.push(["deleteAccount", p]); },
    ...apiOverrides,
  };
  const actions = createProfileActions({ api, getUser: () => state.user, setUser: (u) => { state.user = u; }, logout: async () => { state.loggedOut = true; } });
  return { actions, state, calls };
}

test("changeUsername: validates first (no request on bad input), updates the store from the server answer", async () => {
  const { actions, state, calls } = setup();
  assert.deepEqual(await actions.changeUsername("a"), { ok: false, key: "profile.errors.usernameLength" });
  assert.equal(calls.length, 0);
  assert.deepEqual(await actions.changeUsername("  Bob   Ross "), { ok: true });
  assert.deepEqual(calls[0], ["updateUsername", "Bob Ross"]);
  assert.equal(state.user.username, "Bob Ross");
  // unchanged name: nothing sent
  const n = calls.length;
  await actions.changeUsername("Bob Ross");
  assert.equal(calls.length, n);
});

test("a failed request leaves the old profile untouched and returns a translated key", async () => {
  const { actions, state } = setup({ updateUsername: async () => { throw http(400, "USERNAME_CHARS"); } });
  assert.deepEqual(await actions.changeUsername("Okay name"), { ok: false, key: "profile.errors.usernameChars" });
  assert.equal(state.user.username, "Alice");
});

test("changeEmail needs a valid address and the current password; duplicate is reported", async () => {
  const { actions, state, calls } = setup();
  assert.equal((await actions.changeEmail("nope", "pw")).key, "profile.errors.emailInvalid");
  assert.equal((await actions.changeEmail("new@b.io", "")).key, "profile.errors.passwordRequired");
  assert.equal(calls.length, 0);
  assert.deepEqual(await actions.changeEmail("NEW@b.io", "pw"), { ok: true });
  assert.equal(state.user.email, "new@b.io");
  const dup = setup({ updateEmail: async () => { throw http(409, "EMAIL_IN_USE"); } });
  assert.deepEqual(await dup.actions.changeEmail("x@b.io", "pw"), { ok: false, key: "profile.errors.emailInUse" });
  const wrong = setup({ updateEmail: async () => { throw http(400, "WRONG_PASSWORD"); } });
  assert.equal((await wrong.actions.changeEmail("x@b.io", "bad")).key, "profile.errors.wrongPassword");
});

test("changePassword: client rules, then the server's WRONG_PASSWORD", async () => {
  const { actions, calls } = setup();
  assert.equal((await actions.changePassword("", "New2@password", "New2@password")).key, "profile.errors.currentPasswordRequired");
  assert.equal((await actions.changePassword("Old1!pw", "weak", "weak")).key, "auth.errors.passwordLength");
  assert.equal(calls.length, 0);
  assert.deepEqual(await actions.changePassword("Old1!password", "New2@password", "New2@password"), { ok: true });
  const wrong = setup({ changePassword: async () => { throw http(400, "WRONG_PASSWORD"); } });
  assert.equal((await wrong.actions.changePassword("Bad1!password", "New2@password", "New2@password")).key, "profile.errors.wrongPassword");
});

test("avatar: success replaces the user, progress is forwarded, failure keeps the old avatar", async () => {
  const { actions, state } = setup();
  const seen = [];
  assert.deepEqual(await actions.setAvatar({ uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg" }, (p) => seen.push(p)), { ok: true });
  assert.deepEqual(seen, [50, 100]);
  assert.equal(state.user.avatarUrl, "http://x/media/avatars/a.jpg");

  const withOld = setup({ uploadAvatar: async () => { throw http(413); } }, { ...USER, avatarUrl: "http://x/old.jpg" });
  assert.deepEqual(await withOld.actions.setAvatar({ uri: "u", name: "n", type: "image/jpeg" }), { ok: false, key: "profile.errors.avatarTooLarge" });
  assert.equal(withOld.state.user.avatarUrl, "http://x/old.jpg");
});

test("resetAvatar: nothing to do without an avatar; with one the server answer (null) goes into the store", async () => {
  const none = setup();
  assert.deepEqual(await none.actions.resetAvatar(), { ok: true });
  assert.equal(none.calls.length, 0);
  const has = setup({}, { ...USER, avatarUrl: "http://x/a.jpg" });
  assert.deepEqual(await has.actions.resetAvatar(), { ok: true });
  assert.equal(has.state.user.avatarUrl, null);
  const bad = setup({ removeAvatar: async () => { throw http(0, undefined, "network"); } }, { ...USER, avatarUrl: "http://x/a.jpg" });
  assert.deepEqual(await bad.actions.resetAvatar(), { ok: false, key: "errors.network" });
  assert.equal(bad.state.user.avatarUrl, "http://x/a.jpg");
});

test("signOut and deleteAccount: logout runs; a wrong password does not sign you out", async () => {
  const s = setup();
  await s.actions.signOut();
  assert.equal(s.state.loggedOut, true);

  const d = setup();
  assert.equal((await d.actions.deleteAccount("")).key, "profile.errors.passwordRequired");
  assert.equal(d.state.loggedOut, false);
  assert.deepEqual(await d.actions.deleteAccount("pw"), { ok: true });
  assert.equal(d.state.loggedOut, true);

  const wrong = setup({ deleteAccount: async () => { throw http(400, "WRONG_PASSWORD"); } });
  assert.equal((await wrong.actions.deleteAccount("bad")).key, "profile.errors.wrongPassword");
  assert.equal(wrong.state.loggedOut, false);
});

test("profileErrorKey: code beats status beats kind", () => {
  assert.equal(profileErrorKey(http(400, "WRONG_PASSWORD")), "profile.errors.wrongPassword");
  assert.equal(profileErrorKey(http(413)), "profile.errors.avatarTooLarge");
  assert.equal(profileErrorKey(http(415)), "profile.errors.avatarUnsupported");
  assert.equal(profileErrorKey(http(429)), "profile.errors.tooManyRequests");
  assert.equal(profileErrorKey(http(503)), "errors.server");
  assert.equal(profileErrorKey(http(503), "avatar"), "profile.errors.storageUnavailable"); // no R2 / storage on the server
  assert.equal(profileErrorKey(http(401)), "errors.unauthorized");
  assert.equal(profileErrorKey(http(500)), "errors.server");
  assert.equal(profileErrorKey({ kind: "timeout" }), "errors.timeout");
  assert.equal(profileErrorKey({ kind: "cancelled" }), "profile.errors.cancelled");
  assert.equal(profileErrorKey(new Error("x")), "errors.unexpected");
  assert.equal(profileErrorKey(undefined), "errors.unexpected");
});
