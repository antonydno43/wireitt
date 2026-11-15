import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authSignUp } from '@/server/auth';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/server/auth/local';
import { assertSameOrigin, getClientIp, hitRateLimit, jsonError, jsonNoStore } from '@/server/security';
import { handle } from '@/server/guard';
import { isSupabaseMode } from '@/lib/env';

export const runtime = 'nodejs';

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  name: z.string().trim().max(80).optional().nullable(),
});

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    if (hitRateLimit(`signup:${getClientIp(req)}`, 10, 10 * 60_000)) {
      return jsonError('Too many sign-up attempts. Please try again later.', 429);
    }
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const result = await authSignUp(body.email, body.password, body.name ?? null);

    if (result.error) return jsonError(result.error, 400);
    if (result.needsConfirmation || !result.user) {
      return jsonNoStore({ needsConfirmation: true, user: null });
    }

    // local mode: issue our signed session cookie. Supabase mode: the
    // @supabase/ssr client already set its session cookies.
    if (!isSupabaseMode()) {
      const res = NextResponse.json({ user: result.user }, { status: 201 });
      res.cookies.set(SESSION_COOKIE, signSession(result.user), sessionCookieOptions(req));
      return res as NextResponse;
    }
    return jsonNoStore({ user: result.user }, 201);
  });
}
