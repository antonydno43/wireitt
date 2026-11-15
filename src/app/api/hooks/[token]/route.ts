import { systemStore } from '@/server/store';
import { handle, ApiError } from '@/server/guard';
import { hitRateLimit, jsonError, jsonNoStore } from '@/server/security';
import { executeFlow } from '@/server/engine/execute';
import type { WebhookTriggerPayload } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

const MAX_BODY_BYTES = 64_000;

async function handleHook(req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  if (!token || token.length < 16) throw new ApiError(404, 'Unknown webhook');

  if (hitRateLimit(`hook:${token}`, 120, 60_000)) {
    return jsonError('Webhook rate limit exceeded. Slow down.', 429);
  }

  const sys = await systemStore();
  const flow = await sys.getFlowByWebhookToken(token);
  if (!flow) throw new ApiError(404, 'Unknown webhook');
  if (flow.status !== 'active') {
    return jsonNoStore({ ok: false, error: 'This flow is paused. Activate it to accept webhook calls.' }, 403);
  }

  // assemble the trigger payload
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));

  const headers: Record<string, string> = {};
  for (const key of ['content-type', 'user-agent', 'x-requested-with', 'accept']) {
    const v = req.headers.get(key);
    if (v) headers[key] = v;
  }

  let body: unknown = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonError('Webhook body too large (max 64 KB).', 413);
    }
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
  }

  const payload: WebhookTriggerPayload = { method: req.method, query, headers, body };
  const run = await executeFlow(flow, 'webhook', payload);

  // if the graph contains a Respond node, its output becomes the HTTP response
  const respondStep = Object.values(run.steps ?? {}).find(
    (s) => s.status === 'success' && s.output && typeof s.output === 'object' && 'body' in (s.output as object) && 'status' in (s.output as object)
  );
  if (run.status === 'success' && respondStep) {
    const out = respondStep.output as { status: number; body: unknown };
    const res = NextResponseFrom(out.body, out.status);
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-WireItt-Run', run.id);
    return res;
  }

  const res = jsonNoStore(
    run.status === 'success'
      ? { ok: true, runId: run.id, flow: flow.name, durationMs: run.durationMs }
      : { ok: false, runId: run.id, error: run.error ?? 'Run failed' },
    run.status === 'success' ? 200 : 500
  );
  res.headers.set('X-WireItt-Run', run.id);
  return res;
}

function NextResponseFrom(body: unknown, status: number): Response {
  if (typeof body === 'string') {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return Response.json(body ?? {}, { status });
}

export async function GET(req: Request, ctx: Ctx) {
  return handle(() => handleHook(req, ctx));
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(() => handleHook(req, ctx));
}

export async function PUT(req: Request, ctx: Ctx) {
  return handle(() => handleHook(req, ctx));
}
