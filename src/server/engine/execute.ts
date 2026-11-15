import type { FlowRun, RunStatus, StepResult, TriggerSource } from '@/types';
import type { FlowRecord, NewLogEntry } from '@/server/store/types';
import { systemStore } from '@/server/store';
import { runNode, truncateLogData } from './nodes';
import type { EngineContext } from './templating';

const MAX_RUN_MS = 50_000; // stay under serverless timeouts
const MAX_NODE_EXECUTIONS = 100;
const MAX_LOGS = 300;

export class EngineError extends Error {}

function nodeTitle(type: string): string {
  const map: Record<string, string> = {
    'trigger.manual': 'Manual trigger',
    'trigger.webhook': 'Webhook trigger',
    'trigger.schedule': 'Schedule trigger',
    'action.http': 'HTTP request',
    'action.condition': 'Condition',
    'action.transform': 'Transform',
    'action.delay': 'Delay',
    'action.respond': 'Respond',
    'action.notify': 'Notification',
  };
  return map[type] ?? type;
}

export interface WalkResult {
  steps: Record<string, StepResult>;
  output: unknown;
}

/** Sequential branch-walking executor: deterministic, cycle-safe. */
export async function walkGraph(
  graph: { nodes: { id: string; type: string; data: Record<string, unknown> }[]; edges: { source: string; target: string; sourceHandle?: string | null }[] },
  trigger: TriggerSource,
  payload: unknown,
  logs: NewLogEntry[],
  logBase: { runId: string; flowId: string; userId: string }
): Promise<WalkResult> {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const triggerNode = nodes.find((n) => n.type?.startsWith('trigger.'));
  if (!triggerNode) throw new EngineError('Flow has no trigger node');

  const ctx: EngineContext = {
    trigger: { type: trigger, payload },
    steps: {},
    flow: { id: logBase.flowId, name: '' },
    vars: {},
  };

  const pushLog = (nodeId: string, nodeType: string, level: NewLogEntry['level'], message: string, data?: unknown) => {
    if (logs.length >= MAX_LOGS) return;
    logs.push({
      runId: logBase.runId,
      flowId: logBase.flowId,
      userId: logBase.userId,
      nodeId,
      nodeType,
      level,
      message,
      data: data === undefined ? undefined : truncateLogData(data),
      at: new Date(),
    });
  };

  // trigger step
  ctx.steps[triggerNode.id] = {
    status: 'success',
    output: { type: trigger, payload },
    durationMs: 0,
  };
  pushLog(triggerNode.id, triggerNode.type, 'info', `${nodeTitle(triggerNode.type)} fired (${trigger})`, { payload: truncateLogData(payload) });

  const deadline = Date.now() + MAX_RUN_MS;
  const visited = new Set<string>([triggerNode.id]);
  const queue: string[] = edges.filter((e) => e.source === triggerNode.id).map((e) => e.target);
  let executed = 0;
  let lastRespond: { status: number; body: unknown } | null = null;

  while (queue.length > 0) {
    if (Date.now() > deadline) throw new EngineError('Run exceeded the maximum duration (50s)');
    if (executed >= MAX_NODE_EXECUTIONS) throw new EngineError('Run exceeded the maximum number of node executions');

    const nodeId = queue.shift() as string;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    executed += 1;

    const t0 = Date.now();
    let result: Awaited<ReturnType<typeof runNode>>;
    try {
      result = await runNode(node, ctx);
    } catch (e) {
      const message = (e as Error).message || 'Unknown node error';
      ctx.steps[node.id] = { status: 'error', error: message, durationMs: Date.now() - t0 };
      pushLog(node.id, node.type, 'error', `${nodeTitle(node.type)} failed: ${message}`);
      throw new EngineError(`${nodeTitle(node.type)}: ${message}`);
    }

    ctx.steps[node.id] = {
      status: 'success',
      output: result.output,
      durationMs: Date.now() - t0,
    };
    pushLog(node.id, node.type, 'success', `${nodeTitle(node.type)} — ${result.summary}`, result.output);

    if (node.type === 'action.respond') {
      const out = result.output as { status: number; body: unknown };
      lastRespond = { status: out.status, body: out.body };
    }

    // follow outgoing edges (conditions follow only the matched branch)
    let nextEdges = edges.filter((e) => e.source === node.id);
    if (node.type === 'action.condition') {
      const passed = Boolean((result.output as { passed?: boolean }).passed);
      const wanted = passed ? 'true' : 'false';
      nextEdges = nextEdges.filter((e) => (e.sourceHandle ?? 'true') === wanted);
    }
    for (const edge of nextEdges) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }

  return { steps: ctx.steps, output: lastRespond ?? { completed: true, steps: ctx.steps } };
}

/**
 * Execute a flow end-to-end and persist the run + logs + counters.
 * Uses the trusted system store (works for user runs, webhooks and cron).
 */
export async function executeFlow(
  flow: FlowRecord,
  trigger: TriggerSource,
  payload: unknown
): Promise<FlowRun> {
  const sys = await systemStore();
  const startedAt = new Date();
  const runId = await sys.createRun({
    flowId: flow.id,
    userId: flow.userId,
    triggerType: trigger,
    input: payload,
  });

  const logs: NewLogEntry[] = [];
  let status: RunStatus = 'success';
  let output: unknown;
  let error: string | null = null;
  let steps: Record<string, StepResult> = {};

  try {
    const result = await walkGraph(flow.graph, trigger, payload, logs, {
      runId,
      flowId: flow.id,
      userId: flow.userId,
    });
    steps = result.steps;
    output = result.output;
  } catch (e) {
    status = 'error';
    error = (e as Error).message;
    if (logs.length === 0 || logs[logs.length - 1].level !== 'error') {
      logs.push({
        runId,
        flowId: flow.id,
        userId: flow.userId,
        nodeId: 'run',
        nodeType: 'run',
        level: 'error',
        message: error,
        at: new Date(),
      });
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  try {
    await sys.finishRun(runId, { status, output, error, steps, durationMs, finishedAt });
    await sys.insertLogs(logs);
    await sys.bumpFlowCounters(flow.id, status);
  } catch (e) {
    // persistence failure must not lose the in-memory result
    console.error('[engine] failed to persist run', e);
  }

  return {
    id: runId,
    flowId: flow.id,
    flowName: flow.name,
    status,
    triggerType: trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    error,
    input: payload,
    output,
    steps,
    logs: logs.map((l, i) => ({
      id: `${runId}-${i}`,
      nodeId: l.nodeId,
      nodeType: l.nodeType,
      level: l.level,
      message: l.message,
      data: l.data,
      at: l.at.toISOString(),
    })),
  };
}
