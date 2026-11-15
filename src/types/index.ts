// ============================================================
// WireItt — shared domain types (used by server AND client)
// ============================================================

export const NODE_KINDS = [
  'trigger.manual',
  'trigger.webhook',
  'trigger.schedule',
  'action.http',
  'action.condition',
  'action.transform',
  'action.delay',
  'action.respond',
  'action.notify',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export type FlowStatus = 'active' | 'paused';
export type RunStatus = 'running' | 'success' | 'error';
export type TriggerSource = 'manual' | 'webhook' | 'schedule' | 'test';
export type DeploymentMode = 'cloud' | 'local';

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  createdAt?: string;
}

export interface FlowNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowSchedule {
  type: 'minutes' | 'daily';
  intervalMinutes: number | null;
  time: string | null; // "HH:MM" UTC for daily
  nextRunAt: string | null;
}

/** Flow as returned in list queries (no heavy graph payload). */
export interface FlowListItem {
  id: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  triggerType: NodeKind | null;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  updatedAt: string;
  createdAt: string;
}

/** Full flow (detail / editor). */
export interface Flow extends FlowListItem {
  graph: FlowGraph;
  webhookToken: string | null;
  webhookUrl: string | null;
  schedule: FlowSchedule | null;
}

export interface RunLogEntry {
  id: string;
  nodeId: string;
  nodeType: string;
  level: 'info' | 'success' | 'error';
  message: string;
  data?: unknown;
  at: string;
}

export interface StepResult {
  status: 'success' | 'error';
  output?: unknown;
  error?: string | null;
  durationMs: number;
}

export interface FlowRunSummary {
  id: string;
  flowId: string;
  flowName: string;
  status: RunStatus;
  triggerType: TriggerSource;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface FlowRun extends FlowRunSummary {
  input?: unknown;
  output?: unknown;
  steps?: Record<string, StepResult>;
  logs: RunLogEntry[];
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  total: number;
  success: number;
  error: number;
}

export interface DashboardStats {
  flowsTotal: number;
  flowsActive: number;
  runsTotal: number;
  runs24h: number;
  successRate: number; // 0-100 over recent runs
  daily: DailyBucket[]; // last 7 days, oldest first
  recentRuns: FlowRunSummary[];
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListFlowsResult {
  items: FlowListItem[];
  total: number;
  page: number;
  limit: number;
}

// ---------------- node data shapes (documented contract) ----------------

export interface HttpNodeData {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  headers?: { key: string; value: string }[];
  body?: string;
  timeoutMs?: number;
}

export interface ConditionNodeData {
  left?: string; // template e.g. "{{trigger.payload.status}}"
  operator?:
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'exists'
    | 'not_exists';
  right?: string;
}

export interface TransformNodeData {
  fields?: { key: string; value: string }[];
}

export interface DelayNodeData {
  ms?: number;
}

export interface RespondNodeData {
  status?: number;
  body?: string;
}

export interface NotifyNodeData {
  provider?: 'slack' | 'discord' | 'telegram' | 'custom';
  url?: string;
  text?: string;
  botToken?: string; // telegram only
  chatId?: string; // telegram only
}

export interface ScheduleNodeData {
  mode?: 'minutes' | 'daily';
  intervalMinutes?: number;
  time?: string; // "HH:MM"
}

export interface WebhookTriggerPayload {
  method: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}
