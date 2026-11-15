import { db } from '@/lib/db';
import type {
  AppUser,
  DashboardStats,
  Flow,
  FlowGraph,
  FlowListItem,
  FlowRun,
  FlowRunSummary,
  FlowStatus,
  ListFlowsResult,
  RunStatus,
  StepResult,
  TriggerSource,
} from '@/types';
import type {
  FinishRunInput,
  FlowPatch,
  FlowRecord,
  ListRunsOptions,
  NewLogEntry,
  NewRunInput,
  SystemStore,
  UserStore,
} from './types';
import { hashPassword, verifyPassword } from '@/server/auth/local';
import type { Prisma, Flow as FlowRow, FlowRun as RunRow, FlowRunLog as LogRow, User as UserRow } from '@prisma/client';

// ---------------- row mapping (SQLite stores JSON columns as strings) ----------------

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toFlowRecord(row: FlowRow): FlowRecord {
  const graph: FlowGraph = parseJson<FlowGraph>(row.graph, { nodes: [], edges: [] });
  const flow: Flow = {
    id: row.id,
    name: row.name,
    description: row.description,
    status: (row.status as FlowStatus) ?? 'paused',
    triggerType: (row.triggerType as Flow['triggerType']) ?? null,
    runCount: row.runCount ?? 0,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastRunStatus: (row.lastRunStatus as RunStatus) ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    graph,
    webhookToken: row.webhookToken,
    webhookUrl: null,
    schedule: row.scheduleType
      ? {
          type: row.scheduleType as 'minutes' | 'daily',
          intervalMinutes: row.scheduleInterval,
          time: row.scheduleTime,
          nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
        }
      : null,
  };
  return { ...flow, userId: row.userId };
}

function toRunSummary(row: RunRow & { flow?: { name: string } | null }): FlowRunSummary {
  return {
    id: row.id,
    flowId: row.flowId,
    flowName: row.flow?.name ?? 'Deleted flow',
    status: row.status as FlowRunSummary['status'],
    triggerType: row.triggerType as TriggerSource,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    error: row.error,
  };
}

function flowPatchToData(patch: FlowPatch): Prisma.FlowUpdateInput {
  const data: Prisma.FlowUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.graph !== undefined) data.graph = JSON.stringify(patch.graph);
  if (patch.triggerType !== undefined) data.triggerType = patch.triggerType;
  if (patch.webhookToken !== undefined) data.webhookToken = patch.webhookToken;
  if (patch.scheduleType !== undefined) data.scheduleType = patch.scheduleType;
  if (patch.scheduleInterval !== undefined) data.scheduleInterval = patch.scheduleInterval;
  if (patch.scheduleTime !== undefined) data.scheduleTime = patch.scheduleTime;
  if (patch.nextRunAt !== undefined) data.nextRunAt = patch.nextRunAt;
  return data;
}

// ---------------- local auth (users table + scrypt passwords) ----------------

interface LocalAuthResult {
  user?: AppUser;
  error?: string;
}

function toAppUser(row: UserRow): AppUser {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt.toISOString() };
}

export const localAuth = {
  async signUp(email: string, password: string, name: string | null): Promise<LocalAuthResult> {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return { error: 'An account with this email already exists.' };
    const user = await db.user.create({
      data: { email, name: name || null, passwordHash: hashPassword(password) },
    });
    return { user: toAppUser(user) };
  },

  async signIn(email: string, password: string): Promise<LocalAuthResult> {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return { error: 'Incorrect email or password.' };
    if (!verifyPassword(password, user.passwordHash)) return { error: 'Incorrect email or password.' };
    return { user: toAppUser(user) };
  },
};

// ---------------- user-scoped store (server-side userId checks) ----------------

export const localUserStore: UserStore = {
  async listFlows(userId, opts): Promise<ListFlowsResult> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 100);
    const where: Prisma.FlowWhereInput = { userId };
    if (opts.q?.trim()) where.name = { contains: opts.q.trim() };
    const [rows, total] = await Promise.all([
      db.flow.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.flow.count({ where }),
    ]);
    return {
      items: rows.map(toFlowRecord),
      total,
      page,
      limit,
    };
  },

  async createFlow(userId, input): Promise<FlowRecord> {
    const row = await db.flow.create({
      data: {
        userId,
        name: input.name ?? 'Untitled flow',
        description: input.description ?? null,
        graph: JSON.stringify(input.graph ?? { nodes: [], edges: [] }),
        status: 'paused',
        triggerType: input.triggerType ?? null,
        webhookToken: input.webhookToken ?? null,
        scheduleType: input.scheduleType ?? null,
        scheduleInterval: input.scheduleInterval ?? null,
        scheduleTime: input.scheduleTime ?? null,
        nextRunAt: input.nextRunAt ?? null,
      },
    });
    return toFlowRecord(row);
  },

  async getFlow(userId, flowId): Promise<FlowRecord | null> {
    const row = await db.flow.findFirst({ where: { id: flowId, userId } });
    return row ? toFlowRecord(row) : null;
  },

  async updateFlow(userId, flowId, patch): Promise<FlowRecord | null> {
    const owned = await db.flow.findFirst({ where: { id: flowId, userId }, select: { id: true } });
    if (!owned) return null;
    const row = await db.flow.update({ where: { id: flowId }, data: flowPatchToData(patch) });
    return toFlowRecord(row);
  },

  async deleteFlow(userId, flowId): Promise<boolean> {
    const res = await db.flow.deleteMany({ where: { id: flowId, userId } });
    return res.count > 0;
  },

  async listRuns(userId, opts: ListRunsOptions) {
    const limit = Math.min(Math.max(1, opts.limit ?? 25), 100);
    const where: Prisma.FlowRunWhereInput = { userId };
    if (opts.flowId) where.flowId = opts.flowId;
    if (opts.status && ['success', 'error', 'running'].includes(opts.status)) where.status = opts.status;
    if (opts.cursor) {
      const ts = new Date(opts.cursor);
      if (!Number.isNaN(ts.getTime())) where.startedAt = { lt: ts };
    }
    const rows = await db.flowRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      include: { flow: { select: { name: true } } },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => toRunSummary(r));
    return { items, nextCursor: hasMore ? items[items.length - 1].startedAt : null };
  },

  async getRun(userId, runId): Promise<FlowRun | null> {
    const run = await db.flowRun.findFirst({
      where: { id: runId, userId },
      include: { flow: { select: { name: true } } },
    });
    if (!run) return null;
    const logs = await db.flowRunLog.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
    const result: FlowRun = {
      ...toRunSummary(run),
      input: run.input ? parseJson<unknown>(run.input, undefined) : undefined,
      output: run.output ? parseJson<unknown>(run.output, undefined) : undefined,
      steps: parseJson<Record<string, StepResult>>(run.steps, {}),
      logs: logs.map((l: LogRow) => ({
        id: l.id,
        nodeId: l.nodeId,
        nodeType: l.nodeType,
        level: (l.level as 'info' | 'success' | 'error') ?? 'info',
        message: l.message,
        data: l.data ? parseJson<unknown>(l.data, undefined) : undefined,
        at: l.createdAt.toISOString(),
      })),
    };
    return result;
  },

  async stats(userId): Promise<DashboardStats> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);

    const [flowsTotal, flowsActive, runsTotal, runs24h, weekRows, recentRows] = await Promise.all([
      db.flow.count({ where: { userId } }),
      db.flow.count({ where: { userId, status: 'active' } }),
      db.flowRun.count({ where: { userId } }),
      db.flowRun.count({ where: { userId, startedAt: { gte: dayAgo } } }),
      db.flowRun.findMany({
        where: { userId, startedAt: { gte: weekAgo } },
        select: { startedAt: true, status: true },
        orderBy: { startedAt: 'desc' },
        take: 5000,
      }),
      db.flowRun.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: 8,
        include: { flow: { select: { name: true } } },
      }),
    ]);

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
      const key = r.startedAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.total += 1;
      if (r.status === 'success') b.success += 1;
      else if (r.status === 'error') b.error += 1;
    }

    return {
      flowsTotal,
      flowsActive,
      runsTotal,
      runs24h,
      successRate,
      daily: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
      recentRuns: recentRows.map((r) => toRunSummary(r)),
    };
  },

  async exportFlows(userId): Promise<FlowRecord[]> {
    const rows = await db.flow.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
    return rows.map(toFlowRecord);
  },
};

// ---------------- system store (trusted server paths: webhooks, scheduler) ----------------

export const localSystemStore: SystemStore = {
  async getFlowByWebhookToken(token): Promise<FlowRecord | null> {
    const row = await db.flow.findUnique({ where: { webhookToken: token } });
    return row ? toFlowRecord(row) : null;
  },

  async listDueFlows(now, limit): Promise<FlowRecord[]> {
    const rows = await db.flow.findMany({
      where: {
        status: 'active',
        scheduleType: { not: null },
        nextRunAt: { lte: now },
      },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
    return rows.map(toFlowRecord);
  },

  async createRun(input: NewRunInput): Promise<string> {
    const row = await db.flowRun.create({
      data: {
        flowId: input.flowId,
        userId: input.userId,
        triggerType: input.triggerType,
        status: 'running',
        input: input.input === undefined || input.input === null ? null : JSON.stringify(input.input),
      },
    });
    return row.id;
  },

  async finishRun(runId, result: FinishRunInput): Promise<void> {
    await db.flowRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        output: result.output === undefined || result.output === null ? null : JSON.stringify(result.output),
        error: result.error,
        steps: JSON.stringify(result.steps ?? {}),
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
      },
    });
  },

  async insertLogs(logs: NewLogEntry[]): Promise<void> {
    if (!logs.length) return;
    await db.flowRunLog.createMany({
      data: logs.map((l) => ({
        runId: l.runId,
        flowId: l.flowId,
        userId: l.userId,
        nodeId: l.nodeId,
        nodeType: l.nodeType,
        level: l.level,
        message: l.message.slice(0, 2000),
        data: l.data === undefined || l.data === null ? null : JSON.stringify(l.data),
        createdAt: l.at,
      })),
    });
  },

  async bumpFlowCounters(flowId, status: RunStatus): Promise<void> {
    await db.flow.update({
      where: { id: flowId },
      data: {
        runCount: { increment: 1 },
        lastRunAt: new Date(),
        lastRunStatus: status,
      },
    });
  },

  async setFlowNextRun(flowId, nextRunAt): Promise<void> {
    await db.flow.update({ where: { id: flowId }, data: { nextRunAt } });
  },

  async sweepStaleRuns(olderThanMs): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const res = await db.flowRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: { status: 'error', error: 'Run timed out', finishedAt: new Date() },
    });
    return res.count;
  },

  async cleanupLogs(retentionDays, batch): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600_000);
    const stale = await db.flowRunLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: batch,
    });
    if (!stale.length) return 0;
    const res = await db.flowRunLog.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    return res.count;
  },
};
