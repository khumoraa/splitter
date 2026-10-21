import test from "node:test";
import assert from "node:assert/strict";
import { readImageDims, checkImageQuality } from "./imageInfo.ts";

function jpeg(w, h, totalBytes) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const buf = new Uint8Array(Math.max(totalBytes, head.length));
  buf.set(head);
  // pseudo-random filler so the buffer is not flat
  for (let i = head.length; i < buf.length; i++) buf[i] = (i * 31 + 7) & 255;
  return buf;
}
function png(w, h) {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

test("reads JPEG and PNG dimensions", () => {
  assert.deepEqual(readImageDims(jpeg(900, 1300, 200)), { width: 900, height: 1300 });
  assert.deepEqual(readImageDims(png(640, 480)), { width: 640, height: 480 });
});

test("reads WebP VP8X dimensions", () => {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  // width-1 = 799 (0x31f), height-1 = 599 (0x257)
  b.set([0x1f, 0x03, 0x00], 24);
  b.set([0x57, 0x02, 0x00], 27);
  assert.deepEqual(readImageDims(b), { width: 800, height: 600 });
});

test("garbage and truncated input give null", () => {
  assert.equal(readImageDims(new Uint8Array(10)), null);
  assert.equal(readImageDims(new Uint8Array(100).fill(1)), null);
  assert.equal(readImageDims(jpeg(900, 1300, 200).slice(0, 22)), null);
});

test("quality checks", () => {
  assert.equal(checkImageQuality(jpeg(900, 1300, 60000)).ok, true);
  assert.deepEqual(checkImageQuality(jpeg(200, 300, 60000)), { ok: false, reason: "TOO_SMALL" });
  assert.deepEqual(checkImageQuality(jpeg(9000, 9000, 9_000_000)), { ok: false, reason: "TOO_LARGE_DIMENSIONS" });
  // flat frame: 1280x960 compressing to 3 KB
  assert.deepEqual(checkImageQuality(jpeg(1280, 960, 3000)), { ok: false, reason: "BLANK" });
  assert.deepEqual(checkImageQuality(new Uint8Array(100)), { ok: false, reason: "CORRUPT" });
});
