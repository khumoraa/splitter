import test from "node:test";
import assert from "node:assert/strict";
import { detectImageType } from "./imageType.ts";

const pad = (arr) => Uint8Array.from([...arr, ...new Array(Math.max(0, 16 - arr.length)).fill(0)]);

test("detects JPEG, PNG and WebP by content", () => {
  assert.deepEqual(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0])), { ext: ".jpg", mime: "image/jpeg" });
  assert.deepEqual(detectImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { ext: ".png", mime: "image/png" });
  const webp = pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  assert.deepEqual(detectImageType(webp), { ext: ".webp", mime: "image/webp" });
});

test("rejects everything else, whatever the extension or Content-Type would claim", () => {
  const text = Buffer.from("<html><script>alert(1)</script></html>");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const gif = Buffer.from("GIF89a" + "\0".repeat(20), "binary");
  const heic = pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]); // ....ftypheic
  const exe = pad([0x4d, 0x5a, 0x90, 0x00]);
  for (const b of [text, svg, gif, heic, exe, Buffer.alloc(0), Buffer.alloc(5), new Uint8Array(20)]) assert.equal(detectImageType(b), null);
});

test("RIFF that is not WebP (e.g. WAV/AVI) is rejected", () => {
  assert.equal(detectImageType(pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])), null);
});
