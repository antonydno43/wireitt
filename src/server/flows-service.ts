import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FlowGraph, FlowSchedule, NodeKind } from '@/types';
import { NODE_KINDS } from '@/types';
import type { FlowPatch } from '@/server/store/types';

const MAX_GRAPH_BYTES = 200_000;

export const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        type: z.enum(NODE_KINDS),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .max(100),
  edges: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        source: z.string().min(1).max(64),
        target: z.string().min(1).max(64),
        sourceHandle: z.string().max(32).nullish(),
      })
    )
    .max(200),
});

export class FlowValidationError extends Error {}

/** Validate + normalize a graph; returns the derived trigger type. */
export function validateGraph(graph: unknown): { graph: FlowGraph; triggerType: NodeKind | null } {
  const parsed = graphSchema.safeParse(graph);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new FlowValidationError(`Invalid flow graph: ${issue.path.join('.')} — ${issue.message}`);
  }
  const g = parsed.data as FlowGraph;
  const serialized = JSON.stringify(g);
  if (serialized.length > MAX_GRAPH_BYTES) {
    throw new FlowValidationError('Flow graph is too large (max 200 KB).');
  }
  const triggers = g.nodes.filter((n) => n.type.startsWith('trigger.'));
  if (triggers.length === 0) {
    throw new FlowValidationError('Flow needs exactly one trigger node. Add a trigger from the palette.');
  }
  if (triggers.length > 1) {
    throw new FlowValidationError('Flow can only have one trigger node.');
  }
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const e of g.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new FlowValidationError('Flow contains a connection to a deleted node. Remove it and try again.');
    }
  }
  return { graph: g, triggerType: triggers[0].type };
}

/** Extract schedule config from the schedule trigger node, if present. */
export function deriveSchedule(graph: FlowGraph): {
  scheduleType: 'minutes' | 'daily' | null;
  scheduleInterval: number | null;
  scheduleTime: string | null;
} {
  const node = graph.nodes.find((n) => n.type === 'trigger.schedule');
  if (!node) return { scheduleType: null, scheduleInterval: null, scheduleTime: null };
  const mode = (node.data?.mode as string) === 'daily' ? 'daily' : 'minutes';
  if (mode === 'daily') {
    const time = String(node.data?.time ?? '09:00');
    const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00';
    return { scheduleType: 'daily', scheduleInterval: null, scheduleTime: valid };
  }
  const raw = Number(node.data?.intervalMinutes ?? 5);
  const interval = Math.min(Math.max(Number.isFinite(raw) ? Math.floor(raw) : 5, 1), 525600);
  return { scheduleType: 'minutes', scheduleInterval: interval, scheduleTime: null };
}

export function generateWebhookToken(): string {
  return randomBytes(20).toString('hex');
}

/** Compute the next run time for a schedule (UTC based). */
export function computeNextRun(
  schedule: { type: 'minutes' | 'daily'; intervalMinutes: number | null; time: string | null },
  from: Date
): Date {
  if (schedule.type === 'minutes') {
    const interval = Math.min(Math.max(schedule.intervalMinutes ?? 5, 1), 525600);
    return new Date(from.getTime() + interval * 60_000);
  }
  const [h, m] = (schedule.time ?? '09:00').split(':').map((x) => Number(x));
  const next = new Date(from);
  next.setUTCHours(h || 0, m || 0, 0, 0);
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Build the schedule patch for a flow save (graph-driven). */
export function schedulePatchForSave(graph: FlowGraph, status: 'active' | 'paused'): Pick<FlowPatch, 'scheduleType' | 'scheduleInterval' | 'scheduleTime' | 'nextRunAt'> {
  const derived = deriveSchedule(graph);
  if (!derived.scheduleType) {
    return { scheduleType: null, scheduleInterval: null, scheduleTime: null, nextRunAt: null };
  }
  const schedule: FlowSchedule = {
    type: derived.scheduleType,
    intervalMinutes: derived.scheduleInterval,
    time: derived.scheduleTime,
    nextRunAt: null,
  };
  const nextRunAt = status === 'active' ? computeNextRun(schedule, new Date()) : null;
  return { ...derived, nextRunAt };
}
