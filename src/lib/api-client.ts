import type {
  AppUser,
  DashboardStats,
  DeploymentMode,
  Flow,
  FlowGraph,
  FlowListItem,
  FlowRun,
  FlowRunSummary,
  ListFlowsResult,
  Paginated,
  TriggerSource,
} from '@/types';

export class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `Request failed (${res.status})`;
    throw new ApiClientError(message, res.status);
  }
  return data as T;
}

// ---------------- auth ----------------

export interface MeResponse {
  user: AppUser | null;
  mode: DeploymentMode;
}

export function me() {
  return api<MeResponse>('/api/auth/me');
}

export function signIn(email: string, password: string) {
  return api<{ user: AppUser | null; needsConfirmation?: boolean }>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function signUp(email: string, password: string, name: string | null) {
  return api<{ user: AppUser | null; needsConfirmation?: boolean }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function signOut() {
  return api<{ ok: boolean }>('/api/auth/signout', { method: 'POST' });
}

// ---------------- flows ----------------

export function listFlows(opts: { page?: number; limit?: number; q?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.q) params.set('q', opts.q);
  return api<ListFlowsResult>(`/api/flows?${params.toString()}`);
}

export function createFlow(input: { name?: string; graph?: FlowGraph } = {}) {
  return api<{ flow: Flow }>('/api/flows', { method: 'POST', body: JSON.stringify(input) });
}

export function getFlow(id: string) {
  return api<{ flow: Flow }>(`/api/flows/${id}`);
}

export interface FlowUpdateInput {
  name?: string;
  description?: string | null;
  status?: 'active' | 'paused';
  graph?: FlowGraph;
}

export function updateFlow(id: string, patch: FlowUpdateInput) {
  return api<{ flow: Flow }>(`/api/flows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteFlow(id: string) {
  return api<{ ok: boolean }>(`/api/flows/${id}`, { method: 'DELETE' });
}

export function duplicateFlow(id: string) {
  return api<{ flow: Flow }>(`/api/flows/${id}/duplicate`, { method: 'POST' });
}

export function runFlow(id: string, payload: unknown, trigger: TriggerSource = 'manual') {
  return api<{ run: FlowRun }>(`/api/flows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ payload, trigger }),
  });
}

export function listFlowRuns(id: string, opts: { cursor?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  return api<Paginated<FlowRunSummary>>(`/api/flows/${id}/runs?${params.toString()}`);
}

// ---------------- runs ----------------

export function listRuns(opts: { flowId?: string; status?: string; cursor?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.flowId) params.set('flowId', opts.flowId);
  if (opts.status) params.set('status', opts.status);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  return api<Paginated<FlowRunSummary>>(`/api/runs?${params.toString()}`);
}

export function getRun(id: string) {
  return api<{ run: FlowRun }>(`/api/runs/${id}`);
}

// ---------------- stats ----------------

export function getStats() {
  return api<{ stats: DashboardStats }>('/api/stats');
}

// ---------------- export ----------------

export function exportFlowsUrl() {
  return '/api/flows/export';
}
