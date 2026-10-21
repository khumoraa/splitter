import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { centerSquareCrop } from './avatar-style';

export const AVATAR_PIXELS = 512;

/**
 * Turns whatever the picker returned (HEIC from the iPhone camera roll, a 12 MP JPEG, a PNG...) into a 512x512 JPEG, about
 * 50-150 KB: square centre crop, resized, re-encoded. The server accepts JPEG/PNG/WebP up to 5 MB and rejects HEIC,
 * so this conversion is what makes every photo uploadable.
 */
export async function prepareAvatar(asset: { uri: string; width?: number; height?: number }): Promise<{ uri: string; name: string; type: string }> {
  const actions: Array<{ crop: ReturnType<typeof centerSquareCrop> } | { resize: { width: number; height: number } }> = [];
  if (asset.width && asset.height && asset.width !== asset.height) actions.push({ crop: centerSquareCrop(asset.width, asset.height) });
  actions.push({ resize: { width: AVATAR_PIXELS, height: AVATAR_PIXELS } });
  const out = await manipulateAsync(asset.uri, actions, { compress: 0.8, format: SaveFormat.JPEG });
  return { uri: out.uri, name: 'avatar.jpg', type: 'image/jpeg' };
}
