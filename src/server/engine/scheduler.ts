import { isSupabaseMode } from '@/lib/env';
import { runLogRetentionDays } from '@/lib/env';
import { systemStore } from '@/server/store';
import { executeFlow } from './execute';
import { computeNextRun } from '@/server/flows-service';

const STALE_RUN_MS = 10 * 60_000; // runs stuck in "running" for 10 min are swept

export interface TickResult {
  executed: number;
  swept: number;
  cleaned: number;
  errors: string[];
}

/**
 * One scheduler tick: run due scheduled flows, sweep stale runs and
 * enforce the run-log retention policy. Invoked by:
 *  - /api/cron/tick (Vercel Cron or any external pinger)
 *  - the built-in interval scheduler in local/demo mode
 */
export async function tickMaintenance(): Promise<TickResult> {
  const sys = await systemStore();
  const result: TickResult = { executed: 0, swept: 0, cleaned: 0, errors: [] };

  // 1) due scheduled flows
  let due: Awaited<ReturnType<typeof sys.listDueFlows>> = [];
  try {
    due = await sys.listDueFlows(new Date(), 10);
  } catch (e) {
    result.errors.push(`scheduler query failed: ${(e as Error).message}`);
  }
  for (const flow of due) {
    try {
      await executeFlow(flow, 'schedule', {
        scheduledAt: new Date().toISOString(),
        flowId: flow.id,
        flowName: flow.name,
      });
      result.executed += 1;
    } catch (e) {
      result.errors.push(`flow ${flow.id}: ${(e as Error).message}`);
    } finally {
      const schedule = flow.schedule
        ? { type: flow.schedule.type, intervalMinutes: flow.schedule.intervalMinutes, time: flow.schedule.time }
        : { type: 'minutes' as const, intervalMinutes: 5, time: null };
      try {
        await sys.setFlowNextRun(flow.id, computeNextRun(schedule, new Date()));
      } catch {
        // best effort
      }
    }
  }

  // 2) sweep stale runs
  try {
    result.swept = await sys.sweepStaleRuns(STALE_RUN_MS);
  } catch {
    // best effort
  }

  // 3) retention cleanup (cloud mode only — keeps the table lean at scale)
  if (isSupabaseMode()) {
    try {
      result.cleaned = await sys.cleanupLogs(runLogRetentionDays(), 500);
    } catch {
      // best effort
    }
  }

  return result;
}
