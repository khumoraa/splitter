import test from "node:test";
import assert from "node:assert/strict";
import { isLocalAvatarPath, resolvePublicBaseUrl, rewriteMediaUrls, toStoredLocalPath } from "./mediaUrl.ts";

const ID = "0b8f4a52-3c1d-4e7a-9d2f-6a1b7c3e9f10";

test("only exact /media/avatars/<uuid>.<jpg|png|webp> paths count as local avatars", () => {
  assert.equal(isLocalAvatarPath(`/media/avatars/${ID}.jpg`), true);
  assert.equal(isLocalAvatarPath(`/media/avatars/${ID}.webp`), true);
  for (const bad of [`/media/avatars/../../etc/passwd`, `/media/avatars/${ID}.svg`, `/media/avatars/${ID}.jpg/x`, `/media/avatars/%2e%2e/${ID}.jpg`, `/media/other/${ID}.jpg`, `media/avatars/${ID}.jpg`, `/media/avatars/${ID}.JPG`, "", null, 5]) {
    assert.equal(isLocalAvatarPath(bad), false, String(bad));
  }
});

test("resolvePublicBaseUrl: env wins, LAN hosts are accepted, forged hosts are not", () => {
  assert.equal(resolvePublicBaseUrl("https://api.example.com/", "http", "10.0.0.5:3001"), "https://api.example.com");
  assert.equal(resolvePublicBaseUrl(undefined, "http", "192.168.1.50:3001"), "http://192.168.1.50:3001");
  assert.equal(resolvePublicBaseUrl("", "http", "localhost:3001"), "http://localhost:3001");
  assert.equal(resolvePublicBaseUrl(undefined, "http", "macbook.local:3001"), "http://macbook.local:3001");
  assert.equal(resolvePublicBaseUrl(undefined, "http", "evil.com"), null);
  assert.equal(resolvePublicBaseUrl(undefined, "http", "10.0.0.5@evil.com"), null);
  assert.equal(resolvePublicBaseUrl(undefined, "http", undefined), null);
});

test("rewriteMediaUrls makes local avatar paths absolute everywhere in a body and leaves the rest alone", () => {
  const body = { id: 1, avatarUrl: `/media/avatars/${ID}.jpg`, friends: [{ avatarUrl: null }, { avatarUrl: "https://cdn.example.com/a.png" }], when: new Date(0), nested: { members: [{ avatarUrl: `/media/avatars/${ID}.png` }] } };
  const out = rewriteMediaUrls(body, "http://10.0.0.5:3001");
  assert.equal(out.avatarUrl, `http://10.0.0.5:3001/media/avatars/${ID}.jpg`);
  assert.equal(out.friends[0].avatarUrl, null);
  assert.equal(out.friends[1].avatarUrl, "https://cdn.example.com/a.png");
  assert.equal(out.nested.members[0].avatarUrl, `http://10.0.0.5:3001/media/avatars/${ID}.png`);
  assert.ok(out.when instanceof Date);
  assert.equal(body.avatarUrl, `/media/avatars/${ID}.jpg`, "input is not mutated");
  assert.equal(rewriteMediaUrls(body, null), body);
});

test("toStoredLocalPath keeps only our own media paths", () => {
  assert.equal(toStoredLocalPath(`/media/avatars/${ID}.jpg`), `/media/avatars/${ID}.jpg`);
  assert.equal(toStoredLocalPath(`http://10.0.0.5:3001/media/avatars/${ID}.webp`), `/media/avatars/${ID}.webp`);
  assert.equal(toStoredLocalPath("https://evil.com/pixel.png"), null);
  assert.equal(toStoredLocalPath("javascript:alert(1)"), null);
  assert.equal(toStoredLocalPath("not a url"), null);
});
