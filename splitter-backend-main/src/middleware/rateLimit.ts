import type { NextFunction, Request, Response } from "express";
import { SlidingWindowLimiter } from "../utils/rateLimitCore.js";

/**
 * In-memory rate limit (per process). Key = authenticated user id when available, otherwise the client IP.
 * Enough for a single-instance dev/small deployment; use a shared store (Redis) if you scale out.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const limiter = new SlidingWindowLimiter(opts.windowMs, opts.max);
  setInterval(() => limiter.sweep(), Math.max(opts.windowMs, 60_000)).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${opts.name}:${req.user?.id ?? req.ip ?? "anon"}`;
    const r = limiter.hit(key);
    if (!r.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
      return res.status(429).json({ error: "Too many requests. Please try again later.", retryAfterSeconds: Math.ceil(r.retryAfterMs / 1000) });
    }
    next();
  };
}
