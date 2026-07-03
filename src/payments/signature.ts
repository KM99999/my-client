import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of the raw body, hex-encoded. */
export function hmacHex(rawBody: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Constant-time comparison of two hex signatures. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** Constant-time comparison of two raw strings (e.g. a shared webhook secret). */
export function safeEqualStr(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an HMAC-SHA256 signature over the raw body. Tolerates a `sha256=`
 * prefix (common convention). Returns false on any malformed input — never
 * throws, so a tampered payload is a clean 401 upstream.
 */
export function verifyHmac(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined
): boolean {
  if (!signature || !secret) return false;
  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  try {
    return safeEqualHex(hmacHex(rawBody, secret), provided);
  } catch {
    return false;
  }
}
