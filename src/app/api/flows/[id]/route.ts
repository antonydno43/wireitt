import { z } from 'zod';
import { userStore } from '@/server/store';
import { requireUser, handle, ApiError } from '@/server/guard';
import { assertSameOrigin, jsonNoStore } from '@/server/security';
import { generateWebhookToken, schedulePatchForSave, validateGraph, FlowValidationError } from '@/server/flows-service';
import { webhookUrlFor } from '@/server/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const store = await userStore();
    const flow = await store.getFlow(user.id, id);
    if (!flow) throw new ApiError(404, 'Flow not found');
    return jsonNoStore({ flow: { ...flow, webhookUrl: webhookUrlFor(req, flow.webhookToken) } });
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  status: z.enum(['active', 'paused']).optional(),
  graph: z.unknown().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const store = await userStore();

    const existing = await store.getFlow(user.id, id);
    if (!existing) throw new ApiError(404, 'Flow not found');

    // build the patch
    const patch: Parameters<typeof store.updateFlow>[2] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? null;
    if (body.status !== undefined) patch.status = body.status;

    const nextGraph = body.graph !== undefined ? body.graph : existing.graph;
    if (body.graph !== undefined) {
      let validated;
      try {
        validated = validateGraph(body.graph);
      } catch (e) {
        if (e instanceof FlowValidationError) throw new ApiError(400, e.message);
        throw e;
      }
      patch.graph = validated.graph;
      patch.triggerType = validated.triggerType;

      // webhook token lifecycle: keep a stable token once issued
      if (validated.triggerType === 'trigger.webhook') {
        patch.webhookToken = existing.webhookToken ?? generateWebhookToken();
      } else {
        patch.webhookToken = null;
      }

      const status = body.status ?? existing.status;
      Object.assign(patch, schedulePatchForSave(validated.graph, status));
    } else if (body.status !== undefined && existing.schedule) {
      // activation toggle recomputes the next scheduled run
      Object.assign(patch, schedulePatchForSave(existing.graph, body.status));
    }

    const flow = await store.updateFlow(user.id, id, patch);
    if (!flow) throw new ApiError(404, 'Flow not found');
    return jsonNoStore({ flow: { ...flow, webhookUrl: webhookUrlFor(req, flow.webhookToken) } });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;
    const store = await userStore();
    const deleted = await store.deleteFlow(user.id, id);
    if (!deleted) throw new ApiError(404, 'Flow not found');
    return jsonNoStore({ ok: true });
  });
}
