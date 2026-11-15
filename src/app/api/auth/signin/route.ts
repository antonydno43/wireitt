import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authSignIn } from '@/server/auth';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/server/auth/local';
import { assertSameOrigin, getClientIp, hitRateLimit, jsonError, jsonNoStore } from '@/server/security';
import { handle } from '@/server/guard';
import { isSupabaseMode } from '@/lib/env';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(100),
});

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    if (hitRateLimit(`signin:${getClientIp(req)}`, 10, 10 * 60_000)) {
      return jsonError('Too many sign-in attempts. Please try again later.', 429);
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await authSignIn(body.email, body.password);

    if (result.error || !result.user) {
      return jsonError(result.error ?? 'Invalid credentials', 401);
    }

    if (!isSupabaseMode()) {
      const res = NextResponse.json({ user: result.user });
      res.cookies.set(SESSION_COOKIE, signSession(result.user), sessionCookieOptions(req));
      return res as NextResponse;
    }
    return jsonNoStore({ user: result.user });
  });
}
