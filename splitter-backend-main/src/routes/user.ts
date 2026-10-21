import { Router } from "express";
import type { Response } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../config/prisma.js";
import { PROFILE_SELECT } from "../config/userSelect.js";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { hasJsonContentType, isStrongPassword, PASSWORD_POLICY_MESSAGE } from "../utils/validation.js";
import { checkUsername } from "../utils/username.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: User
 *   description: Update my own profile. Errors carry a stable `code` next to the English `error`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sensitiveLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, name: "account-sensitive" });

const USERNAME_MESSAGES = {
  required: "Username is required",
  length: "Username must be 2-32 characters",
  chars: "Username may contain letters, digits, spaces and . _ ' -",
} as const;

/**
 * @swagger
 * /user/username:
 *   patch:
 *     summary: Change my display name (2-32 characters, letters/digits/space . _ ' -)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: The updated profile }
 *       400: { description: "code USERNAME_REQUIRED | USERNAME_LENGTH | USERNAME_CHARS" }
 */
router.patch("/username", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!hasJsonContentType(req)) return res.status(415).json({ error: "Content-Type must be application/json" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const check = checkUsername(req.body?.username);
    if (!check.ok) {
      return res.status(400).json({ error: USERNAME_MESSAGES[check.reason], code: `USERNAME_${check.reason.toUpperCase()}` });
    }
    const updated = await prisma.user.update({ where: { id: req.user.id }, data: { username: check.value }, select: PROFILE_SELECT });
    return res.json(updated);
  } catch (err) {
    console.error("/user/username error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /user/email:
 *   patch:
 *     summary: Change my email (requires my current password)
 *     description: "Body { email, currentPassword }."
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: The updated profile }
 *       400: { description: "code INVALID_EMAIL | PASSWORD_REQUIRED | WRONG_PASSWORD" }
 *       409: { description: "code EMAIL_IN_USE" }
 *       429: { description: Too many attempts }
 */
router.patch("/email", authenticateToken, sensitiveLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!hasJsonContentType(req)) return res.status(415).json({ error: "Content-Type must be application/json" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { email, currentPassword } = req.body ?? {};
    const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
      return res.status(400).json({ error: "Invalid email format", code: "INVALID_EMAIL" });
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ error: "Current password is required", code: "PASSWORD_REQUIRED" });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!me) return res.status(404).json({ error: "User not found" });
    if (!(await bcrypt.compare(currentPassword, me.password))) {
      return res.status(400).json({ error: "Current password is incorrect", code: "WRONG_PASSWORD" });
    }
    if (clean === me.email) return res.json({ id: me.id, email: me.email, username: me.username, uniqueId: me.uniqueId, avatarUrl: me.avatarUrl });

    try {
      const updated = await prisma.user.update({ where: { id: req.user.id }, data: { email: clean }, select: PROFILE_SELECT });
      return res.json(updated);
    } catch (e: any) {
      if (e?.code === "P2002") return res.status(409).json({ error: "Email already in use", code: "EMAIL_IN_USE" });
      throw e;
    }
  } catch (err) {
    console.error("/user/email error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * @swagger
 * /user/password:
 *   patch:
 *     summary: Change my password (requires my current password)
 *     description: "Body { currentPassword, newPassword }. The new password needs 8+ characters with upper, lower, digit and a special character."
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ success: true }" }
 *       400: { description: "code PASSWORD_REQUIRED | WEAK_PASSWORD | SAME_PASSWORD | WRONG_PASSWORD" }
 *       429: { description: Too many attempts }
 */
router.patch("/password", authenticateToken, sensitiveLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!hasJsonContentType(req)) return res.status(415).json({ error: "Content-Type must be application/json" });
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string") {
      return res.status(400).json({ error: "Both currentPassword and newPassword are required", code: "PASSWORD_REQUIRED" });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE, code: "WEAK_PASSWORD" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(400).json({ error: "Current password is incorrect", code: "WRONG_PASSWORD" });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "Choose a different password", code: "SAME_PASSWORD" });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { password: await bcrypt.hash(newPassword, 10) } });
    return res.json({ success: true });
  } catch (err) {
    // never log the request body here: it contains passwords
    console.error("/user/password error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
