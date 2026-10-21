import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { R2NotConfiguredError } from "../config/r2.js";
import { prisma } from "../config/prisma.js";
import { PROFILE_SELECT } from "../config/userSelect.js";
import { getAvatarStorage } from "../storage/avatarStorage.js";
import { releaseAvatar } from "../storage/releaseAvatar.js";
import { detectImageType } from "../utils/imageType.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Uploads
 *   description: File uploads (avatars)
 */

export const AVATAR_MAX_BYTES = Number(process.env.AVATAR_MAX_BYTES || 5 * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 4, parts: 8 },
});

/** multer errors are turned into proper JSON answers (413 for an oversized file, 400 for a malformed form) */
function receiveAvatarFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large", maxBytes: AVATAR_MAX_BYTES });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: "Invalid upload: send a single image in the 'file' field" });
    }
    // busboy errors for a broken form, e.g. a hand-written 'Content-Type: multipart/form-data' header without a boundary
    if (err instanceof Error && /^(Multipart|Unexpected end of form|Malformed)/i.test(err.message)) {
      return res.status(400).json({ error: "Malformed multipart form (do not set the Content-Type header yourself; let the HTTP client add the boundary)" });
    }
    return next(err);
  });
}

/**
 * @swagger
 * /uploads/avatar:
 *   post:
 *     summary: Upload the current user's avatar (multipart/form-data, field "file")
 *     description: JPEG, PNG or WebP, up to 5 MB (checked by content, not by name or Content-Type). 10 uploads per 10 minutes.
 *     tags: [Uploads]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ success, avatarUrl, key, user }; the previous file is deleted"
 *       400: { description: No file / malformed form }
 *       413: { description: File too large }
 *       415: { description: Not a JPEG, PNG or WebP image }
 *       429: { description: Too many uploads }
 *       503: { description: Image storage is not configured }
 */
router.post(
  "/avatar",
  authenticateToken,
  rateLimit({ windowMs: 10 * 60_000, max: 10, name: "avatar-upload" }),
  receiveAvatarFile,
  async (req: Request, res: Response) => {
    let stored: string | null = null;
    const storage = getAvatarStorage();
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const file = req.file;
      if (!file || !file.buffer?.length) {
        return res.status(400).json({ error: "file is required" });
      }

      // The real type comes from the bytes. The client's Content-Type and file name are ignored.
      const kind = detectImageType(file.buffer);
      if (!kind) {
        return res.status(415).json({ error: "Unsupported image type. Use JPEG, PNG or WebP" });
      }

      const before = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
      stored = (await storage.put(file.buffer, kind.ext, kind.mime)).stored;

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: stored },
        select: PROFILE_SELECT,
      });
      void releaseAvatar(before?.avatarUrl);

      return res.json({ success: true, avatarUrl: user.avatarUrl, key: stored, user });
    } catch (err) {
      // do not leave an orphan file when the database update failed
      if (stored) void releaseAvatar(stored);
      if (err instanceof R2NotConfiguredError) {
        return res.status(503).json({ error: "Avatar storage is not configured" });
      }
      console.error("POST /uploads/avatar error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
