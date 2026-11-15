import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { AppUser } from '@/types';
import { appSecret } from '@/lib/env';

export const SESSION_COOKIE = 'wireitt_session';
const SESSION_TTL_S = 60 * 60 * 24 * 7; // 7 days

// ---------------- password hashing (scrypt) ----------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ---------------- signed session tokens ----------------

interface SessionPayload {
  uid: string;
  email: string;
  name: string | null;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signSession(user: { id: string; email: string; name: string | null }): string {
  const payload: SessionPayload = {
    uid: user.id,
    email: user.email,
    name: user.name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', appSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', appSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (!payload.uid || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(req: Request) {
  const proto = req.headers.get('x-forwarded-proto');
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: proto === 'https',
    path: '/',
    maxAge: SESSION_TTL_S,
  };
}

export async function getLocalSessionUser(): Promise<AppUser | null> {
  const store = await cookies();
  const payload = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { id: payload.uid, email: payload.email, name: payload.name };
}
