/**
 * Cheap, dependency-free checks on an uploaded image, run BEFORE the paid AI call.
 * Pure module (no imports). Dimensions are read from the file headers; "blank" detection is a size heuristic
 * because we cannot decode pixels without a library: a uniform (black/white) picture compresses to a tiny file,
 * while a photo of text does not.
 */
export type ImageDims = { width: number; height: number };

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

/** Reads width/height from a JPEG, PNG or WebP header; null if the structure is damaged. */
export function readImageDims(buf: Uint8Array): ImageDims | null {
  if (!buf || buf.length < 24) return null;
  // PNG: IHDR is the first chunk, width/height at offsets 16 and 20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = u32be(buf, 16);
    const height = u32be(buf, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // JPEG: walk the markers until a start-of-frame (SOF0..SOF15 except DHT/JPG/DAC)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1]!;
      if (marker === 0xff) { o++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(buf, o + 2);
      if (len < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = u16be(buf, o + 5);
        const width = u16be(buf, o + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) {
    const fourcc = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
    if (fourcc === "VP8X") {
      const width = u24le(buf, 24) + 1;
      const height = u24le(buf, 27) + 1;
      return { width, height };
    }
    if (fourcc === "VP8L") {
      const b0 = buf[21]!, b1 = buf[22]!, b2 = buf[23]!, b3 = buf[24]!;
      const width = (((b1 & 0x3f) << 8) | b0) + 1;
      const height = ((((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))) + 1;
      return { width, height };
    }
    if (fourcc === "VP8 ") {
      const width = (buf[26]! | (buf[27]! << 8)) & 0x3fff;
      const height = (buf[28]! | (buf[29]! << 8)) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
  }
  return null;
}

/** Smallest side we accept: below this the text of a receipt cannot be read. */
export const MIN_SIDE_PX = 320;
/** Longest side we accept; the client downsizes to 1280, anything bigger is wasted upload. */
export const MAX_SIDE_PX = 8000;
/**
 * Compressed bytes per pixel below which an image carries practically no detail.
 * A 1280x960 photo of a receipt at JPEG quality 0.6 is >= ~0.05 B/px; a flat black or white frame is < 0.005.
 */
export const BLANK_BYTES_PER_PIXEL = 0.01;

export type ImageProblem = "CORRUPT" | "TOO_SMALL" | "TOO_LARGE_DIMENSIONS" | "BLANK";

export function checkImageQuality(buf: Uint8Array): { ok: true; dims: ImageDims } | { ok: false; reason: ImageProblem } {
  const dims = readImageDims(buf);
  if (!dims) return { ok: false, reason: "CORRUPT" };
  if (Math.min(dims.width, dims.height) < MIN_SIDE_PX) return { ok: false, reason: "TOO_SMALL" };
  if (Math.max(dims.width, dims.height) > MAX_SIDE_PX) return { ok: false, reason: "TOO_LARGE_DIMENSIONS" };
  // WebP/PNG lossless are legitimately small for flat graphics; only apply the heuristic to lossy photos (JPEG)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (isJpeg && buf.length / (dims.width * dims.height) < BLANK_BYTES_PER_PIXEL) return { ok: false, reason: "BLANK" };
  return { ok: true, dims };
}
