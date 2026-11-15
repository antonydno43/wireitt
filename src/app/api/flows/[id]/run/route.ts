import { userStore } from '@/server/store';
import { requireUser, handle, ApiError } from '@/server/guard';
import { assertSameOrigin, hitRateLimit, jsonError, jsonNoStore } from '@/server/security';
import { executeFlow } from '@/server/engine/execute';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const MAX_PAYLOAD_BYTES = 64_000;

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;

    if (hitRateLimit(`run:${user.id}`, 30, 60_000)) {
      return jsonError('Too many runs — please wait a moment before running again.', 429);
    }

    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return jsonError('Payload too large (max 64 KB).', 413);
    }
    let payload: unknown = undefined;
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw);
      } catch {
        return jsonError('Payload must be valid JSON.', 400);
      }
    }
    // allow { payload, trigger } envelope or a raw payload
    let trigger: 'manual' | 'test' = 'manual';
    if (
      payload &&
      typeof payload === 'object' &&
      'payload' in (payload as Record<string, unknown>) &&
      'trigger' in (payload as Record<string, unknown>)
    ) {
      const envelope = payload as { payload?: unknown; trigger?: unknown };
      payload = envelope.payload ?? null;
      if (envelope.trigger === 'test') trigger = 'test';
    }

    const store = await userStore();
    const flow = await store.getFlow(user.id, id);
    if (!flow) throw new ApiError(404, 'Flow not found');

    // engine persists run rows through the trusted system store
    const run = await executeFlow(flow, trigger, payload ?? null);
    return jsonNoStore({ run });
  });
}
