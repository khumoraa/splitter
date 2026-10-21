import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { fitSize, type CropRect } from './crop';

/** Longest side sent to the server, JPEG quality, and the hard cap that must stay under the server limit (3 MB decoded). */
export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.6;
const MAX_BYTES = 2_500_000;

export interface PreparedImage {
  base64: string;
  uri: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * Rotate -> crop -> downscale -> JPEG. Also converts HEIC/PNG/WebP picked from the gallery to JPEG.
 * `rotation` is applied first, so `crop` is expressed in the ROTATED image's pixels (what the preview shows).
 */
export async function prepareForUpload(args: {
  uri: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  crop?: CropRect | null;
}): Promise<PreparedImage> {
  const swapped = args.rotation === 90 || args.rotation === 270;
  const rotated = swapped ? { width: args.height, height: args.width } : { width: args.width, height: args.height };
  const actions: Action[] = [];
  if (args.rotation) actions.push({ rotate: args.rotation });
  const area = args.crop ?? { originX: 0, originY: 0, ...rotated };
  if (args.crop) actions.push({ crop: args.crop });
  const target = fitSize({ width: area.width, height: area.height }, MAX_SIDE);
  if (target.width !== area.width) actions.push({ resize: { width: target.width } });

  let out = await manipulateAsync(args.uri, actions, { compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
  if ((out.base64?.length ?? 0) * 0.75 > MAX_BYTES) {
    deleteLocalFile(out.uri);
    out = await manipulateAsync(args.uri, actions, { compress: 0.4, format: SaveFormat.JPEG, base64: true });
  }
  if (!out.base64) throw new Error('prepare failed');
  return { base64: out.base64, uri: out.uri, mimeType: 'image/jpeg', width: out.width, height: out.height };
}

/** Removes a temporary photo from the app cache. Never throws. */
export function deleteLocalFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone or not ours to delete */
  }
}
