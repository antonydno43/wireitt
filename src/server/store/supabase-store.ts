import type { Flow, FlowGraph, FlowRun, FlowRunSummary, FlowStatus, RunStatus, TriggerSource } from '@/types';
import type { FinishRunInput, FlowPatch, FlowRecord, ListRunsOptions, NewLogEntry, NewRunInput, SystemStore, UserStore } from './types';
import { createUserClient, getServiceClient } from '@/server/auth/supabase';

// ---------------- row shapes (snake_case from Postgres) ----------------

interface FlowRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  graph: { nodes?: unknown[]; edges?: unknown[] } | null;
  trigger_type: string | null;
  webhook_token: string | null;
  schedule_type: string | null;
  schedule_interval: number | null;
  schedule_time: string | null;
  next_run_at: string | null;
  run_count: number;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  flow_id: string;
  status: string;
  trigger_type: string;
  input: unknown;
  output: unknown;
  error: string | null;
  steps: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  flows?: { name: string } | null;
}

interface LogRow {
  id: number;
  run_id: string;
  node_id: string;
  node_type: string;
  level: string;
  message: string;
  data: unknown;
  created_at: string;
}

const FLOW_COLUMNS = '*';

function toFlowRecord(row: FlowRow): FlowRecord {
  const graph: FlowGraph =
    row.graph && Array.isArray(row.graph.nodes) && Array.isArray(row.graph.edges)
      ? (row.graph as unknown as FlowGraph)
      : { nodes: [], edges: [] };
  const flow: Flow = {
    id: row.id,
    name: row.name,
    description: row.description,
    status: (row.status as FlowStatus) ?? 'paused',
    triggerType: (row.trigger_type as Flow['triggerType']) ?? null,
    runCount: Number(row.run_count ?? 0),
    lastRunAt: row.last_run_at,
    lastRunStatus: (row.last_run_status as RunStatus) ?? null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    graph,
    webhookToken: row.webhook_token,
    webhookUrl: null,
    schedule: row.schedule_type
      ? {
          type: row.schedule_type as 'minutes' | 'daily',
          intervalMinutes: row.schedule_interval,
          time: row.schedule_time,
          nextRunAt: row.next_run_at,
        }
      : null,
  };
  return { ...flow, userId: row.user_id };
}

function toRunSummary(row: RunRow): FlowRunSummary {
  return {
    id: row.id,
    flowId: row.flow_id,
    flowName: row.flows?.name ?? 'Deleted flow',
    status: row.status as FlowRunSummary['status'],
    triggerType: row.trigger_type as TriggerSource,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    error: row.error,
  };
}

function flowPatchToColumns(patch: FlowPatch): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.graph !== undefined) data.graph = patch.graph;
  if (patch.triggerType !== undefined) data.trigger_type = patch.triggerType;
  if (patch.webhookToken !== undefined) data.webhook_token = patch.webhookToken;
  if (patch.scheduleType !== undefined) data.schedule_type = patch.scheduleType;
  if (patch.scheduleInterval !== undefined) data.schedule_interval = patch.scheduleInterval;
  if (patch.scheduleTime !== undefined) data.schedule_time = patch.scheduleTime;
  if (patch.nextRunAt !== undefined) data.next_run_at = patch.nextRunAt ? patch.nextRunAt.toISOString() : null;
  return data;
}

// ---------------- user-scoped store (RLS enforced via user JWT) ----------------

export const supabaseUserStore: UserStore = {
  async listFlows(userId, opts) {
    const supabase = await createUserClient();
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 100);
    let query = supabase
      .from('flows')
      .select(FLOW_COLUMNS, { count: 'exact' })
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (opts.q?.trim()) query = query.ilike('name', `%${opts.q.trim()}%`);
    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []).map((r) => toFlowRecord(r as FlowRow)),
      total: count ?? 0,
      page,
      limit,
    };
  },

  async createFlow(userId, input) {
    const supabase = await createUserClient();
    const { data, error } = await supabase
      .from('flows')
      .insert({
        user_id: userId,
        name: input.name ?? 'Untitled flow',
        description: input.description ?? null,
        graph: input.graph ?? { nodes: [], edges: [] },
        status: 'paused',
        trigger_type: input.triggerType ?? null,
        webhook_token: input.webhookToken ?? null,
        schedule_type: input.scheduleType ?? null,
        schedule_interval: input.scheduleInterval ?? null,
        schedule_time: input.scheduleTime ?? null,
        next_run_at: input.nextRunAt ? input.nextRunAt.toISOString() : null,
      })
      .select(FLOW_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create flow');
    return toFlowRecord(data as FlowRow);
  },

  async getFlow(userId, flowId) {
    const supabase = await createUserClient();
    const { data } = await supabase
      .from('flows')
      .select(FLOW_COLUMNS)
      .eq('id', flowId)
      .eq('user_id', userId)
      .maybeSingle();
    return data ? toFlowRecord(data as FlowRow) : null;
  },

  async updateFlow(userId, flowId, patch) {
    const supabase = await createUserClient();
    const columns = flowPatchToColumns(patch);
    const { data, error } = await supabase
      .from('flows')
      .update(columns)
      .eq('id', flowId)
      .eq('user_id', userId)
      .select(FLOW_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toFlowRecord(data as FlowRow) : null;
  },

  async deleteFlow(userId, flowId) {
    const supabase = await createUserClient();
    const { error } = await supabase.from('flows').delete().eq('id', flowId).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return true;
  },

  async listRuns(userId, opts: ListRunsOptions) {
    const supabase = await createUserClient();
    const limit = Math.min(Math.max(1, opts.limit ?? 25), 100);
    let query = supabase
      .from('flow_runs')
      .select('*, flows(name)')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit + 1);
    if (opts.flowId) query = query.eq('flow_id', opts.flowId);
    if (opts.status && ['success', 'error', 'running'].includes(opts.status)) {
      query = query.eq('status', opts.status);
    }
    if (opts.cursor) {
      const ts = new Date(opts.cursor);
      if (!Number.isNaN(ts.getTime())) query = query.lt('started_at', ts.toISOString());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RunRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toRunSummary);
    return { items, nextCursor: hasMore ? items[items.length - 1].startedAt : null };
  },

  async getRun(userId, runId) {
    const supabase = await createUserClient();
    const { data: run } = await supabase
      .from('flow_runs')
      .select('*, flows(name)')
      .eq('id', runId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!run) return null;
    const { data: logs } = await supabase
      .from('flow_run_logs')
      .select('*')
      .eq('run_id', runId)
      .order('id', { ascending: true });
    const row = run as RunRow;
    const result: FlowRun = {
      ...toRunSummary(row),
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      steps: (row.steps as FlowRun['steps']) ?? {},
      logs: ((logs ?? []) as LogRow[]).map((l) => ({
        id: String(l.id),
        nodeId: l.node_id,
        nodeType: l.node_type,
        level: (l.level as 'info' | 'success' | 'error') ?? 'info',
        message: l.message,
        data: l.data ?? undefined,
        at: l.created_at,
      })),
    };
    return result;
  },

  async stats(userId) {
    const supabase = await createUserClient();
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();

    const [flowsRes, activeRes, runsRes, runs24hRes, weekRes, recentRes] = await Promise.all([
      supabase.from('flows').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('flows').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
      supabase.from('flow_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('flow_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('started_at', dayAgo),
      supabase
        .from('flow_runs')
        .select('started_at, status')
        .eq('user_id', userId)
        .gte('started_at', weekAgo)
        .order('started_at', { ascending: false })
        .limit(5000),
      supabase
        .from('flow_runs')
        .select('*, flows(name)')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(8),
    ]);

    const weekRows = (weekRes.data ?? []) as { started_at: string; status: string }[];
    const recentStatuses = weekRows.slice(0, 200).map((r) => r.status);
    const finished = recentStatuses.filter((s) => s !== 'running');
    const successes = finished.filter((s) => s === 'success').length;
    const successRate = finished.length ? Math.round((successes / finished.length) * 100) : 100;

    const buckets = new Map<string, { total: number; success: number; error: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600_000);
      buckets.set(d.toISOString().slice(0, 10), { total: 0, success: 0, error: 0 });
    }
    for (const r of weekRows) {
      const key = (r.started_at ?? '').slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.total += 1;
      if (r.status === 'success') b.success += 1;
      else if (r.status === 'error') b.error += 1;
    }

    return {
      flowsTotal: flowsRes.count ?? 0,
      flowsActive: activeRes.count ?? 0,
      runsTotal: runsRes.count ?? 0,
      runs24h: runs24hRes.count ?? 0,
      successRate,
      daily: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
      recentRuns: ((recentRes.data ?? []) as RunRow[]).map(toRunSummary),
    };
  },

  async exportFlows(userId) {
    const supabase = await createUserClient();
    const { data, error } = await supabase
      .from('flows')
      .select(FLOW_COLUMNS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => toFlowRecord(r as FlowRow));
  },
};

// ---------------- system store (service role — trusted server paths only) ----------------

export const supabaseSystemStore: SystemStore = {
  async getFlowByWebhookToken(token) {
    const supabase = getServiceClient();
    const { data } = await supabase.from('flows').select(FLOW_COLUMNS).eq('webhook_token', token).maybeSingle();
    return data ? toFlowRecord(data as FlowRow) : null;
  },

  async listDueFlows(now, limit) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('flows')
      .select(FLOW_COLUMNS)
      .eq('status', 'active')
      .not('schedule_type', 'is', null)
      .lte('next_run_at', now.toISOString())
      .order('next_run_at', { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => toFlowRecord(r as FlowRow));
  },

  async createRun(input: NewRunInput) {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('flow_runs')
      .insert({
        flow_id: input.flowId,
        user_id: input.userId,
        trigger_type: input.triggerType,
        status: 'running',
        input: (input.input ?? null) as never,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create run');
    return data.id as string;
  },

  async finishRun(runId, result: FinishRunInput) {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from('flow_runs')
      .update({
        status: result.status,
        output: (result.output ?? null) as never,
        error: result.error,
        steps: result.steps as never,
        finished_at: result.finishedAt.toISOString(),
        duration_ms: result.durationMs,
      })
      .eq('id', runId);
    if (error) throw new Error(error.message);
  },

  async insertLogs(logs: NewLogEntry[]) {
    if (!logs.length) return;
    const supabase = getServiceClient();
    const rows = logs.map((l) => ({
      run_id: l.runId,
      flow_id: l.flowId,
      user_id: l.userId,
      node_id: l.nodeId,
      node_type: l.nodeType,
      level: l.level,
      message: l.message.slice(0, 2000),
      data: (l.data ?? null) as never,
      created_at: l.at.toISOString(),
    }));
    // chunk inserts to keep payloads small
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('flow_run_logs').insert(rows.slice(i, i + 100) as never);
      if (error) throw new Error(error.message);
    }
  },

  async bumpFlowCounters(flowId, status) {
    const supabase = getServiceClient();
    const { error } = await supabase.rpc('bump_flow_run', { p_flow_id: flowId, p_status: status });
    if (error) throw new Error(error.message);
  },

  async setFlowNextRun(flowId, nextRunAt) {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from('flows')
      .update({ next_run_at: nextRunAt ? nextRunAt.toISOString() : null })
      .eq('id', flowId);
    if (error) throw new Error(error.message);
  },

  async sweepStaleRuns(olderThanMs) {
    const supabase = getServiceClient();
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { data } = await supabase
      .from('flow_runs')
      .select('id')
      .eq('status', 'running')
      .lt('started_at', cutoff)
      .limit(200);
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    if (!ids.length) return 0;
    await supabase
      .from('flow_runs')
      .update({ status: 'error', error: 'Run timed out', finished_at: new Date().toISOString() })
      .in('id', ids);
    return ids.length;
  },

  async cleanupLogs(retentionDays, batch) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('cleanup_old_logs', { p_days: retentionDays, p_batch: batch });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },
};
