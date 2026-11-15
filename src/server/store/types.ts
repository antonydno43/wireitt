import type {
  DashboardStats,
  Flow,
  FlowGraph,
  FlowListItem,
  FlowRun,
  FlowRunSummary,
  FlowStatus,
  ListFlowsResult,
  NodeKind,
  Paginated,
  RunStatus,
  StepResult,
  TriggerSource,
} from '@/types';

export interface FlowPatch {
  name?: string;
  description?: string | null;
  status?: FlowStatus;
  graph?: FlowGraph;
  triggerType?: NodeKind | null;
  webhookToken?: string | null;
  scheduleType?: 'minutes' | 'daily' | null;
  scheduleInterval?: number | null;
  scheduleTime?: string | null;
  nextRunAt?: Date | null;
}

/** Flow record including owner — internal to the server. */
export type FlowRecord = Flow & { userId: string };

export interface ListRunsOptions {
  flowId?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
}

export interface UserStore {
  listFlows(userId: string, opts: { page?: number; limit?: number; q?: string }): Promise<ListFlowsResult>;
  createFlow(
    userId: string,
    input: {
      name?: string;
      description?: string | null;
      graph?: FlowGraph;
      triggerType?: NodeKind | null;
      webhookToken?: string | null;
      scheduleType?: 'minutes' | 'daily' | null;
      scheduleInterval?: number | null;
      scheduleTime?: string | null;
      nextRunAt?: Date | null;
    }
  ): Promise<FlowRecord>;
  getFlow(userId: string, flowId: string): Promise<FlowRecord | null>;
  updateFlow(userId: string, flowId: string, patch: FlowPatch): Promise<FlowRecord | null>;
  deleteFlow(userId: string, flowId: string): Promise<boolean>;
  listRuns(userId: string, opts: ListRunsOptions): Promise<Paginated<FlowRunSummary>>;
  getRun(userId: string, runId: string): Promise<FlowRun | null>;
  stats(userId: string): Promise<DashboardStats>;
  exportFlows(userId: string): Promise<FlowRecord[]>;
}

export interface NewRunInput {
  flowId: string;
  userId: string;
  triggerType: TriggerSource;
  input: unknown;
}

export interface NewLogEntry {
  runId: string;
  flowId: string;
  userId: string;
  nodeId: string;
  nodeType: string;
  level: 'info' | 'success' | 'error';
  message: string;
  data?: unknown;
  at: Date;
}

export interface FinishRunInput {
  status: RunStatus;
  output: unknown;
  error: string | null;
  steps: Record<string, StepResult>;
  durationMs: number;
  finishedAt: Date;
}

/**
 * Trusted (system) store. Local mode: direct Prisma access.
 * Cloud mode: Supabase service-role client (bypasses RLS) — used only by
 * server-side trusted paths: webhook execution, scheduler, maintenance.
 */
export interface SystemStore {
  getFlowByWebhookToken(token: string): Promise<FlowRecord | null>;
  listDueFlows(now: Date, limit: number): Promise<FlowRecord[]>;
  createRun(input: NewRunInput): Promise<string>;
  finishRun(runId: string, result: FinishRunInput): Promise<void>;
  insertLogs(logs: NewLogEntry[]): Promise<void>;
  bumpFlowCounters(flowId: string, status: RunStatus): Promise<void>;
  setFlowNextRun(flowId: string, nextRunAt: Date | null): Promise<void>;
  sweepStaleRuns(olderThanMs: number): Promise<number>;
  cleanupLogs(retentionDays: number, batch: number): Promise<number>;
}
