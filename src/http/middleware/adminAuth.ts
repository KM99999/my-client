import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "./errors.js";

/**
 * Milestone-1 admin guard: a shared secret in the `x-admin-api-key` header.
 * Full auth is a later enhancement. No admin route is reachable without it.
 */
export function adminAuth(req: Request, _res: Response, next: NextFunction) {
  const provided = req.header("x-admin-api-key");
  if (!env.ADMIN_API_KEY) {
    throw new HttpError(500, "admin_key_not_configured");
  }
  if (!provided || provided !== env.ADMIN_API_KEY) {
    throw new HttpError(401, "unauthorized");
  }
  next();
}
