import { NextResponse } from 'next/server';

// ---------------------------------------------------------------
// Lightweight per-instance protections (rate limiting, origin
// checks). On serverless each instance keeps its own window, which
// still absorbs bursts and abuse; the database + RLS remain the
// authoritative security boundary.
// ---------------------------------------------------------------

type Bucket = { hits: number[] };
const globalForRate = globalThis as unknown as { __wireittRate?: Map<string, Bucket> };

function getBuckets(): Map<string, Bucket> {
  if (!globalForRate.__wireittRate) globalForRate.__wireittRate = new Map();
  return globalForRate.__wireittRate;
}

/** Returns true when the request should be rejected. */
export function hitRateLimit(key: string, limit: number, windowMs: number): boolean {
  const buckets = getBuckets();
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return true;
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 5000) {
    // opportunistic cleanup
    for (const [k, b] of buckets) {
      if (b.hits.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }
  return false;
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * CSRF mitigation for cookie-authenticated mutations: when a browser sends
 * an Origin header it must match the request host. Non-browser clients
 * (webhooks, curl, Vercel cron) send no Origin and pass.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  try {
    const originHost = new URL(origin).host;
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (host && originHost !== host) {
      throw new Error('Cross-origin request blocked');
    }
  } catch {
    throw new Error('Invalid origin');
  }
}

export function jsonNoStore(data: unknown, status = 200): NextResponse {
  const res = NextResponse.json(data, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function jsonError(message: string, status = 400): NextResponse {
  return jsonNoStore({ error: message }, status);
}
