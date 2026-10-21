import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { deleteAvatarObject, isR2Configured, r2PublicBase, uploadAvatarObject } from "../config/r2.js";
import { isLocalAvatarPath, LOCAL_AVATAR_PREFIX } from "../utils/mediaUrl.js";

/**
 * Where avatar files live. R2 when configured (production), the server's own disk otherwise (development / LAN).
 * What is stored in User.avatarUrl: a relative "/media/avatars/<uuid>.<ext>" for disk files (made absolute per request, see
 * middleware/mediaUrls.ts), the absolute CDN URL for R2 files.
 */
export interface AvatarStorage {
  readonly kind: "r2" | "local";
  /** Saves the bytes under an unguessable name; returns the value to store in User.avatarUrl. */
  put(buf: Buffer, ext: string, mime: string): Promise<{ stored: string }>;
  /** Deletes the file behind a stored value if (and only if) it is one of ours. Never throws; returns whether something was deleted. */
  deleteStored(stored: string | null | undefined): Promise<boolean>;
}

export const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
export const AVATAR_DIR = path.join(UPLOADS_ROOT, "avatars");

class LocalDiskAvatarStorage implements AvatarStorage {
  readonly kind = "local" as const;

  async put(buf: Buffer, ext: string): Promise<{ stored: string }> {
    await fs.mkdir(AVATAR_DIR, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    // "wx": never overwrite an existing file
    await fs.writeFile(path.join(AVATAR_DIR, name), buf, { flag: "wx", mode: 0o644 });
    return { stored: `${LOCAL_AVATAR_PREFIX}${name}` };
  }

  async deleteStored(stored: string | null | undefined): Promise<boolean> {
    // only the exact "/media/avatars/<uuid>.<ext>" shape is accepted, so no path can escape AVATAR_DIR
    if (!isLocalAvatarPath(stored)) return false;
    try {
      await fs.unlink(path.join(AVATAR_DIR, path.basename(stored)));
      return true;
    } catch {
      return false;
    }
  }
}

class R2AvatarStorage implements AvatarStorage {
  readonly kind = "r2" as const;

  async put(buf: Buffer, ext: string, mime: string): Promise<{ stored: string }> {
    const key = `avatars/${randomUUID()}${ext}`;
    const { url } = await uploadAvatarObject(key, buf, mime);
    return { stored: url };
  }

  async deleteStored(stored: string | null | undefined): Promise<boolean> {
    const base = r2PublicBase();
    if (!stored || !base || !stored.startsWith(`${base}/avatars/`)) return false;
    const key = stored.slice(base.length + 1);
    if (!/^avatars\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return false;
    try {
      await deleteAvatarObject(key);
      return true;
    } catch {
      return false;
    }
  }
}

const local = new LocalDiskAvatarStorage();
const r2 = new R2AvatarStorage();

export function getAvatarStorage(): AvatarStorage {
  return isR2Configured() ? r2 : local;
}

/** Deletes a stored avatar from whichever storage owns it (handles the case where R2 was configured later or removed). */
export async function deleteAnyStoredAvatar(stored: string | null | undefined): Promise<boolean> {
  return (await local.deleteStored(stored)) || (await r2.deleteStored(stored));
}
