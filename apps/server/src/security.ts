import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

/**
 * Defense-in-depth for the self-hosted server: response security headers, a same-origin
 * (CSRF) guard for mutating requests, and a small in-memory rate limiter for auth. Kept
 * dependency-free and single-process — appropriate for a local self-host deployment.
 */

// The SPA is same-origin; it only calls /api and loads its own bundled assets. `'unsafe-inline'`
// is needed for the pre-paint theme script in index.html and Recharts' inline styles; a stricter
// script policy would require hashing that bootstrap script.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function applySecurityHeaders(reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  reply.header("Content-Security-Policy", CSP);
  if (env.secureCookies) reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const hostname = (hostHeader: string): string => hostHeader.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

/**
 * CSRF guard: a state-changing request that carries a browser Origin/Referer must be
 * same-origin as the server. Requests with no Origin (native/headless API clients) pass —
 * they cannot be driven cross-site by a victim's browser. Loopback hosts are treated as one
 * origin so the dev proxy (localhost:5173 → :4000) and the single-service host both work.
 */
export function isSameOrigin(req: FastifyRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = req.headers.origin;
  const refererOrigin = (() => {
    try {
      return req.headers.referer ? new URL(req.headers.referer).origin : null;
    } catch {
      return null;
    }
  })();
  const source = origin && origin !== "null" ? origin : refererOrigin;
  if (!source) return true; // no browser origin → not a cross-site form post
  let srcHost: string;
  try {
    srcHost = new URL(source).hostname;
  } catch {
    return false;
  }
  const dstHost = hostname(req.headers.host ?? "");
  if (srcHost === dstHost) return true;
  return LOOPBACK.has(srcHost) && LOOPBACK.has(dstHost);
}

/** Fixed-window in-memory limiter: at most `max` hits per `windowMs` for a given key. Sweeps its
 *  own expired entries at most once per window so the map can't grow unbounded with stale keys. */
export function makeRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  let lastSweep = Date.now();
  return function allow(key: string): boolean {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
      lastSweep = now;
    }
    const cur = hits.get(key);
    if (!cur || now > cur.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= max;
  };
}
