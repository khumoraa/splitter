import test from "node:test";
import assert from "node:assert/strict";
import { scanFlowReducer, initialScanFlow, stepIndex } from "./scan-flow.ts";
import { getScanOptions } from "./scan-options.ts";
import { frameToCrop, fitSize, cropToView } from "./crop.ts";
import fs from "node:fs";
import { describeScanFailure, SCAN_ERROR_KEYS } from "./scan-errors.ts";

const run = (events, s = initialScanFlow) => events.reduce(scanFlowReducer, s);

test("happy path", () => {
  const s = run([{ type: "START" }, { type: "UPLOADED" }, { type: "RESPONSE_OK" }, { type: "FINISHED" }]);
  assert.equal(s.phase, "done");
  assert.deepEqual(["uploading", "reading", "checking", "done", "idle"].map(stepIndex), [0, 1, 2, 2, -1]);
});
test("errors, cancel and slow only act on an active attempt", () => {
  assert.deepEqual(run([{ type: "START" }, { type: "FAIL", code: "QUOTA_EXCEEDED" }]), { phase: "error", errorCode: "QUOTA_EXCEEDED", slow: false });
  assert.equal(run([{ type: "START" }, { type: "UPLOADED" }, { type: "CANCEL" }]).phase, "cancelled");
  assert.equal(run([{ type: "START" }, { type: "SLOW" }]).slow, true);
  assert.equal(run([{ type: "CANCEL" }]).phase, "idle");
  assert.equal(run([{ type: "SLOW" }]).slow, false);
  // a late response after Cancel must not resurrect the attempt
  assert.equal(run([{ type: "START" }, { type: "CANCEL" }, { type: "RESPONSE_OK" }, { type: "FINISHED" }]).phase, "cancelled");
  assert.equal(run([{ type: "START" }, { type: "CANCEL" }, { type: "FAIL", code: "X" }]).phase, "cancelled");
});
test("double START does not restart; RESET returns to idle", () => {
  const s = run([{ type: "START" }, { type: "UPLOADED" }]);
  assert.equal(scanFlowReducer(s, { type: "START" }), s);
  assert.equal(run([{ type: "START" }, { type: "FAIL", code: "X" }, { type: "RESET" }]).phase, "idle");
  assert.equal(run([{ type: "START" }, { type: "FAIL", code: "X" }, { type: "START" }]).phase, "uploading");
});

test("options: limit exhausted or offline blocks AI but never manual", () => {
  const base = { online: true, quotaStatus: "ok", remaining: 5 };
  assert.deepEqual(getScanOptions(base), { ai: { enabled: true, reason: null }, manual: { enabled: true } });
  assert.deepEqual(getScanOptions({ ...base, remaining: 0 }).ai, { enabled: false, reason: "quota_exhausted" });
  assert.deepEqual(getScanOptions({ ...base, online: false }).ai, { enabled: false, reason: "offline" });
  assert.deepEqual(getScanOptions({ online: true, quotaStatus: "error", remaining: null, quotaErrorKind: "http", quotaErrorStatus: 503 }).ai, { enabled: false, reason: "unavailable" });
  assert.deepEqual(getScanOptions({ online: true, quotaStatus: "error", remaining: null, quotaErrorKind: "network" }).ai, { enabled: false, reason: "offline" });
  assert.deepEqual(getScanOptions({ online: true, quotaStatus: "error", remaining: null, quotaErrorKind: "http", quotaErrorStatus: 429 }).ai.reason, "quota_exhausted");
  assert.equal(getScanOptions({ online: true, quotaStatus: "loading", remaining: null }).ai.enabled, true);
  assert.equal(getScanOptions({ online: true, quotaStatus: "error", remaining: null, quotaErrorKind: "unknown" }).ai.enabled, true);
  for (const o of [{ online: false, quotaStatus: "error", remaining: null }, { ...base, remaining: 0 }]) assert.equal(getScanOptions(o).manual.enabled, true);
});

test("frameToCrop: cover and contain", () => {
  // 1000x2000 image shown "cover" in a 400x400 view: scale 0.4, shows the middle 1000x1000 band
  const c = frameToCrop({ width: 1000, height: 2000 }, { width: 400, height: 400 }, { x: 0, y: 0, width: 400, height: 400 }, "cover");
  assert.deepEqual(c, { originX: 0, originY: 500, width: 1000, height: 1000 });
  const inner = frameToCrop({ width: 1000, height: 2000 }, { width: 400, height: 400 }, { x: 100, y: 100, width: 200, height: 200 }, "cover");
  assert.deepEqual(inner, { originX: 250, originY: 750, width: 500, height: 500 });
  // contain: 1000x500 image in a 400x400 view: scale 0.4, bars of 100 above/below
  const k = frameToCrop({ width: 1000, height: 500 }, { width: 400, height: 400 }, { x: 0, y: 100, width: 400, height: 200 }, "contain");
  assert.deepEqual(k, { originX: 0, originY: 0, width: 1000, height: 500 });
  // a frame partly over the bars is clamped to the image
  const clamped = frameToCrop({ width: 1000, height: 500 }, { width: 400, height: 400 }, { x: -50, y: 0, width: 500, height: 400 }, "contain");
  assert.deepEqual(clamped, { originX: 0, originY: 0, width: 1000, height: 500 });
  const tiny = frameToCrop({ width: 100, height: 100 }, { width: 100, height: 100 }, { x: 50, y: 50, width: 0, height: 0 }, "cover");
  assert.ok(tiny.width >= 1 && tiny.height >= 1);
});
test("fitSize never upscales", () => {
  assert.deepEqual(fitSize({ width: 4000, height: 3000 }, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitSize({ width: 800, height: 600 }, 1280), { width: 800, height: 600 });
  assert.deepEqual(fitSize({ width: 3000, height: 4000 }, 1280), { width: 960, height: 1280 });
});

test("error mapping by code, status and kind", () => {
  assert.deepEqual(describeScanFailure({ kind: "http", status: 422, code: "INVALID_IMAGE", details: { reason: "BLANK" } }), { key: "scan.errors.invalidImage.BLANK", action: "retake", code: "INVALID_IMAGE" });
  assert.equal(describeScanFailure({ kind: "http", status: 422, code: "INVALID_IMAGE", details: { reason: "weird" } }).key, "scan.errors.invalidImage.CORRUPT");
  assert.equal(describeScanFailure({ kind: "http", status: 429, code: "QUOTA_EXCEEDED" }).action, "none");
  assert.equal(describeScanFailure({ kind: "http", status: 503 }).key, "scan.errors.aiUnavailable");
  assert.equal(describeScanFailure({ kind: "network" }).key, "scan.errors.offline");
  assert.equal(describeScanFailure({ kind: "timeout" }).key, "scan.errors.timeout");
  assert.equal(describeScanFailure({ kind: "http", status: 500 }).key, "scan.errors.unknown");
  for (const code of ["NOT_A_RECEIPT", "PARSE_FAILED", "IMAGE_TOO_LARGE", "REQUEST_IN_PROGRESS"]) {
    assert.ok(SCAN_ERROR_KEYS.includes(describeScanFailure({ kind: "http", code }).key), code);
  }
});

test("cropToView is the inverse of frameToCrop for contain", () => {
  const image = { width: 1000, height: 500 };
  const view = { width: 400, height: 400 };
  const frame = { x: 40, y: 140, width: 200, height: 100 };
  const crop = frameToCrop(image, view, frame, "contain");
  const back = cropToView(image, view, crop);
  assert.ok(Math.abs(back.x - frame.x) < 1 && Math.abs(back.y - frame.y) < 1 && Math.abs(back.width - frame.width) < 1 && Math.abs(back.height - frame.height) < 1);
});

const locale = (l) => JSON.parse(fs.readFileSync(new URL(`../../../shared/config/locales/${l}.json`, import.meta.url), "utf8"));
const lookup = (obj, key) => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

test("every error key and every dynamic scan key exists in en, ja and uz", () => {
  const dynamic = [
    "scan.processing.step.uploading", "scan.processing.step.reading", "scan.processing.step.checking",
    "scan.processing.state.done", "scan.processing.state.active", "scan.processing.state.pending", "scan.errors.quotaNoTime",
  ];
  for (const l of ["en", "ja", "uz"]) {
    const j = locale(l);
    for (const k of [...SCAN_ERROR_KEYS, ...dynamic]) assert.equal(typeof lookup(j, k), "string", `${l}: ${k}`);
    for (const base of ["scan.new.leftToday", "scan.new.leftMonth", "scan.new.draft.summary", "scan.manual.count"]) {
      assert.equal(typeof lookup(j, base + "_one"), "string", `${l}: ${base}_one`);
      assert.equal(typeof lookup(j, base + "_other"), "string", `${l}: ${base}_other`);
    }
    // interpolation placeholders must be identical across languages
    const en = locale("en");
    for (const k of ["scan.review.mismatch", "scan.new.blocked.quota", "scan.errors.quota", "scan.review.fixHintMissing", "scan.manual.itemLine"]) {
      const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
      assert.equal(ph(lookup(j, k)), ph(lookup(en, k)), `${l}: placeholders of ${k}`);
    }
  }
});
