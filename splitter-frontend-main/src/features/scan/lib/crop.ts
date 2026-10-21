/**
 * Maps a frame drawn over a displayed image to a crop rectangle in the image's own pixels. Pure geometry.
 * `cover`: the image fills the view and overflows (camera preview). `contain`: the whole image is visible with bars.
 */
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface CropRect { originX: number; originY: number; width: number; height: number }

export function frameToCrop(image: Size, view: Size, frame: Rect, fit: 'cover' | 'contain'): CropRect {
  const sx = view.width / image.width;
  const sy = view.height / image.height;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const dispW = image.width * scale;
  const dispH = image.height * scale;
  const offX = (view.width - dispW) / 2; // negative for cover, positive for contain
  const offY = (view.height - dispH) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const x0 = clamp(Math.round((frame.x - offX) / scale), 0, image.width - 1);
  const y0 = clamp(Math.round((frame.y - offY) / scale), 0, image.height - 1);
  const x1 = clamp(Math.round((frame.x + frame.width - offX) / scale), x0 + 1, image.width);
  const y1 = clamp(Math.round((frame.y + frame.height - offY) / scale), y0 + 1, image.height);
  return { originX: x0, originY: y0, width: x1 - x0, height: y1 - y0 };
}

/** Longest side after downscaling to `maxSide`; never upscales. */
export function fitSize(image: Size, maxSide: number): Size {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxSide) return { width: image.width, height: image.height };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(image.width * k)), height: Math.max(1, Math.round(image.height * k)) };
}

/** Inverse of frameToCrop for `contain`: where a crop rectangle (image pixels) lies in the view, to draw the overlay. */
export function cropToView(image: Size, view: Size, crop: CropRect): Rect {
  const scale = Math.min(view.width / image.width, view.height / image.height);
  const offX = (view.width - image.width * scale) / 2;
  const offY = (view.height - image.height * scale) / 2;
  return { x: offX + crop.originX * scale, y: offY + crop.originY * scale, width: crop.width * scale, height: crop.height * scale };
}
