import type { NextFunction, Request, Response } from "express";
import { resolvePublicBaseUrl, rewriteMediaUrls } from "../utils/mediaUrl.js";

/** Makes relative local avatar paths absolute in every JSON response, using the address the client used to reach us. */
export function absoluteMediaUrls(req: Request, res: Response, next: NextFunction) {
  const base = resolvePublicBaseUrl(process.env.PUBLIC_BASE_URL, req.protocol, req.get("host"));
  if (base) {
    const original = res.json.bind(res);
    res.json = ((body: unknown) => original(rewriteMediaUrls(body, base))) as typeof res.json;
  }
  next();
}
