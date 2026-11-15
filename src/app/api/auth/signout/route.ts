import { NextResponse } from 'next/server';
import { authSignOut } from '@/server/auth';
import { SESSION_COOKIE } from '@/server/auth/local';
import { assertSameOrigin, jsonNoStore } from '@/server/security';
import { handle } from '@/server/guard';
import { isSupabaseMode } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    await authSignOut();
    const res = NextResponse.json({ ok: true });
    if (!isSupabaseMode()) {
      res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    }
    return res as NextResponse;
  });
}

export const dynamic = 'force-dynamic';
