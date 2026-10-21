import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import axios, { isCancel } from "axios";
import { ApiError, isApiError, isUnauthorized, isOffline, isCancelled, logLevelForStatus, logLevelForError } from "./api-error.ts";

test("expected 4xx outcomes log as warnings, server and network failures as errors", () => {
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(logLevelForStatus(s), "warn", String(s));
  for (const s of [500, 502, 503]) assert.equal(logLevelForStatus(s), "error", String(s));
  assert.equal(logLevelForStatus(undefined), "error"); // no response: network / timeout
  assert.equal(logLevelForStatus(399), "error");
});

test("ApiError carries kind and status; helpers branch on them, not on text", () => {
  const unauth = new ApiError("Sitzung abgelaufen", "http", 401);
  assert.ok(isApiError(unauth) && unauth instanceof Error);
  assert.equal(isUnauthorized(unauth), true);
  assert.equal(isUnauthorized(new ApiError("x", "http", 500)), false);
  assert.equal(isUnauthorized(new Error("Authorization failed")), false);
  assert.equal(isOffline(new ApiError("x", "network")), true);
  assert.equal(isOffline(new ApiError("x", "timeout")), true);
  assert.equal(isOffline(new ApiError("x", "http", 503)), false);
  assert.equal(new ApiError("x", "network").status, undefined);
});


test("isCancelled recognises only cancelled ApiErrors", () => {
  assert.equal(isCancelled(new ApiError("Request cancelled", "cancelled")), true);
  assert.equal(isCancelled(new ApiError("x", "network")), false);
  assert.equal(isCancelled(new Error("Request cancelled")), false);
  assert.equal(isOffline(new ApiError("Request cancelled", "cancelled")), false);
});

test("axios reports an aborted request via axios.isCancel (the check the interceptor relies on)", async () => {
  const server = http.createServer(() => { /* never answers */ });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const controller = new AbortController();
  const pending = axios.get(`http://127.0.0.1:${port}/`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (e) => isCancel(e) === true && e.code === "ERR_CANCELED");
  server.closeAllConnections?.();
  server.close();
});


test("logLevelForError: offline, timeout, cancel and 4xx are warnings; 5xx and non-API errors are errors", () => {
  assert.equal(logLevelForError(new ApiError("x", "timeout")), "warn");
  assert.equal(logLevelForError(new ApiError("x", "network")), "warn");
  assert.equal(logLevelForError(new ApiError("x", "cancelled")), "warn");
  assert.equal(logLevelForError(new ApiError("x", "http", 409)), "warn");
  assert.equal(logLevelForError(new ApiError("x", "http", 503)), "error");
  assert.equal(logLevelForError(new TypeError("boom")), "error");
});
