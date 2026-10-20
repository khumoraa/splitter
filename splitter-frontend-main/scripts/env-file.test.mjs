import test from "node:test";
import assert from "node:assert/strict";
import { upsertEnvVar, readEnvVar, pickLanIp } from "./env-file.mjs";

test("upsertEnvVar replaces only the target line and keeps every other line", () => {
  const before = "# comment\nA=1\nEXPO_PUBLIC_API_URL=http://old:3001\nSECRET=keep-me\n\n";
  const after = upsertEnvVar(before, "EXPO_PUBLIC_API_URL", "http://10.0.0.5:3001");
  assert.equal(after, "# comment\nA=1\nEXPO_PUBLIC_API_URL=http://10.0.0.5:3001\nSECRET=keep-me\n\n".replace(/\n+$/, "\n"));
  assert.match(after, /^SECRET=keep-me$/m);
});

test("upsertEnvVar appends when missing and creates content for an empty file", () => {
  assert.equal(upsertEnvVar("A=1\n", "K", "v"), "A=1\nK=v\n");
  assert.equal(upsertEnvVar("A=1", "K", "v"), "A=1\nK=v\n");
  assert.equal(upsertEnvVar("", "K", "v"), "K=v\n");
});

test("upsertEnvVar does not touch similarly named variables", () => {
  const out = upsertEnvVar("EXPO_PUBLIC_API_URL_OLD=x\nEXPO_PUBLIC_API_URL=y\n", "EXPO_PUBLIC_API_URL", "z");
  assert.equal(out, "EXPO_PUBLIC_API_URL_OLD=x\nEXPO_PUBLIC_API_URL=z\n");
});

test("readEnvVar", () => {
  assert.equal(readEnvVar("A=1\nK= http://x \n", "K"), "http://x");
  assert.equal(readEnvVar("A=1\n", "K"), undefined);
});

test("pickLanIp prefers physical private IPv4 and skips loopback/public/IPv6", () => {
  const ifs = {
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    utun3: [{ family: "IPv4", address: "100.64.0.2", internal: false }],
    en0: [{ family: "IPv6", address: "fe80::1", internal: false }, { family: "IPv4", address: "10.20.2.24", internal: false }],
    awdl0: [{ family: "IPv4", address: "192.168.9.9", internal: false }],
  };
  assert.equal(pickLanIp(ifs), "10.20.2.24");
  assert.equal(pickLanIp({ lo0: ifs.lo0 }), undefined);
});
