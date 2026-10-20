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
