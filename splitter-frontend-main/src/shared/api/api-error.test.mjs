import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, isApiError, isUnauthorized, isOffline } from "./api-error.ts";

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

import http from "node:http";
import axios from "axios";
import { isCancelled } from "./api-error.ts";

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
  await assert.rejects(pending, (e) => axios.isCancel(e) === true && e.code === "ERR_CANCELED");
  server.closeAllConnections?.();
  server.close();
});
