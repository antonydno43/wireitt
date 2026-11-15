import { userStore } from '@/server/store';
import { requireUser, handle, ApiError } from '@/server/guard';
import { assertSameOrigin, jsonNoStore } from '@/server/security';
import { generateWebhookToken, schedulePatchForSave } from '@/server/flows-service';
import { webhookUrlFor } from '@/server/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await ctx.params;
    const store = await userStore();

    const source = await store.getFlow(user.id, id);
    if (!source) throw new ApiError(404, 'Flow not found');

    const hasWebhookTrigger = source.graph.nodes.some((n) => n.type === 'trigger.webhook');
    const copy = await store.createFlow(user.id, {
      name: `${source.name} (copy)`.slice(0, 120),
      description: source.description,
      graph: source.graph,
    });

    // carry over trigger metadata: fresh webhook token + schedule config
    const schedule = schedulePatchForSave(source.graph, 'paused');
    const flow = await store.updateFlow(user.id, copy.id, {
      triggerType: source.triggerType,
      webhookToken: hasWebhookTrigger ? generateWebhookToken() : null,
      scheduleType: schedule.scheduleType,
      scheduleInterval: schedule.scheduleInterval,
      scheduleTime: schedule.scheduleTime,
    });
    if (!flow) throw new ApiError(500, 'Failed to duplicate flow');

    return jsonNoStore({ flow: { ...flow, webhookUrl: webhookUrlFor(req, flow.webhookToken) } }, 201);
  });
}
