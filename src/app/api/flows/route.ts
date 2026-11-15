import { z } from 'zod';
import { userStore } from '@/server/store';
import { requireUser, handle, parsePagination, ApiError } from '@/server/guard';
import { assertSameOrigin, jsonNoStore } from '@/server/security';
import { generateWebhookToken, schedulePatchForSave, validateGraph, FlowValidationError } from '@/server/flows-service';
import { webhookUrlFor } from '@/server/webhook';
import type { FlowRecord } from '@/server/store/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const { page, limit } = parsePagination(url);
    const q = url.searchParams.get('q') ?? undefined;
    const store = await userStore();
    const result = await store.listFlows(user.id, { page, limit, q });
    return jsonNoStore(result);
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  graph: z.unknown().optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = createSchema.parse(await req.json().catch(() => ({})));

    // fresh flows start with a manual trigger node wired to nothing yet
    const defaultGraph = {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger.manual',
          position: { x: 80, y: 160 },
          data: {},
        },
      ],
      edges: [],
    };

    // validate + derive trigger metadata (trigger type, webhook token, schedule)
    let graph = defaultGraph as unknown as import('@/types').FlowGraph;
    let triggerType: import('@/types').NodeKind | null = 'trigger.manual';
    let webhookToken: string | null = null;
    let schedule: ReturnType<typeof schedulePatchForSave> | null = null;
    if (body.graph !== undefined) {
      try {
        const validated = validateGraph(body.graph);
        graph = validated.graph;
        triggerType = validated.triggerType;
        webhookToken = validated.triggerType === 'trigger.webhook' ? generateWebhookToken() : null;
        schedule = schedulePatchForSave(validated.graph, 'paused');
      } catch (e) {
        if (e instanceof FlowValidationError) throw new ApiError(400, e.message);
        throw e;
      }
    }

    const store = await userStore();
    const flow: FlowRecord = await store.createFlow(user.id, {
      name: body.name || 'Untitled flow',
      description: body.description ?? null,
      graph,
      triggerType,
      webhookToken,
      scheduleType: schedule?.scheduleType ?? null,
      scheduleInterval: schedule?.scheduleInterval ?? null,
      scheduleTime: schedule?.scheduleTime ?? null,
      nextRunAt: schedule?.nextRunAt ?? null,
    });
    return jsonNoStore({ flow: { ...flow, webhookUrl: webhookUrlFor(req, flow.webhookToken) } }, 201);
  });
}
