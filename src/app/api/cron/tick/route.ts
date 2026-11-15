import { isSupabaseMode, cronSecret } from '@/lib/env';
import { tickMaintenance } from '@/server/engine/scheduler';
import { handle } from '@/server/guard';
import { jsonError, jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Scheduler tick endpoint.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this
 * automatically when CRON_SECRET is set) or `?secret=...` for external
 * pingers such as cron-job.org.
 */
async function tick(req: Request): Promise<Response> {
  const secret = cronSecret();
  const url = new URL(req.url);

  if (secret) {
    const auth = req.headers.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const provided = bearer ?? url.searchParams.get('secret');
    if (provided !== secret) return jsonError('Unauthorized', 401);
  } else if (isSupabaseMode()) {
    // cloud deployments must protect this endpoint
    return jsonError('CRON_SECRET is not configured on this deployment.', 500);
  }

  const result = await tickMaintenance();
  return jsonNoStore({ ok: true, ...result });
}

export async function GET(req: Request) {
  return handle(() => tick(req));
}

export async function POST(req: Request) {
  return handle(() => tick(req));
}
