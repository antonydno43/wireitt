'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Activity, Plus, RotateCw, TrendingUp, Workflow, Zap } from 'lucide-react';
import type { AppUser, DashboardStats } from '@/types';
import { getStats } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  EmptyState,
  PageLoader,
  RelativeTime,
  StatCard,
  StatusBadge,
  TriggerSourceChip,
  formatDuration,
  type StatTone,
} from '@/components/app/shared';

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '–';
  try {
    return format(parsed, 'EEEEEE');
  } catch {
    return '–';
  }
}

export function DashboardView({
  user,
  onNewFlow,
  onOpenFlow,
  onOpenRuns,
}: {
  user: AppUser;
  onNewFlow: () => void;
  onOpenFlow: (flowId: string) => void;
  onOpenRuns: () => void;
}) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await getStats();
      setStats(res.stats);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load the dashboard.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    load();
  }, [load]);

  // silent re-fetch every 20s while the tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !stats) {
    return <PageLoader />;
  }

  if (error && !stats) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Failed to load the dashboard</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div>
          <Button variant="outline" onClick={() => load()}>
            <RotateCw className="size-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!stats) return <PageLoader />;

  const firstName = user.name?.trim().split(/\s+/)[0] || user.email.split('@')[0];
  const isEmpty = stats.flowsTotal === 0;

  const successRate = Math.round(stats.successRate);
  const rateTone: StatTone = successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error';

  const maxDaily = Math.max(0, ...stats.daily.map((d) => d.total));
  const allZero = stats.daily.every((d) => d.total === 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what your automations have been up to.</p>
        </div>
        <Button onClick={onNewFlow} className="w-full sm:w-auto">
          <Plus className="size-4" />
          New flow
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Workflow} label="Total flows" value={String(stats.flowsTotal)} />
        <StatCard
          icon={Zap}
          label="Active flows"
          value={String(stats.flowsActive)}
          tone={stats.flowsActive > 0 ? 'success' : 'default'}
        />
        <StatCard icon={Activity} label="Runs in 24h" value={String(stats.runs24h)} />
        <StatCard
          icon={TrendingUp}
          label="Success rate"
          value={`${successRate}%`}
          tone={rateTone}
          hint="last 200 runs"
        />
      </div>

      {isEmpty ? (
        <EmptyState
          icon={Workflow}
          title="Create your first flow"
          description="Wire a trigger to an action and run it in seconds."
          action={
            <Button onClick={onNewFlow}>
              <Plus className="size-4" />
              New flow
            </Button>
          }
        />
      ) : (
        <>
          {/* Runs — last 7 days */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">Runs — last 7 days</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  success
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                  failed
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2 border-b border-border pb-px">
                {stats.daily.map((bucket) => (
                  <div key={bucket.date} className="flex flex-1 flex-col items-center gap-2">
                    <div
                      className="flex h-36 w-full flex-col justify-end gap-0.5"
                      title={`${bucket.date}: ${bucket.total} runs (${bucket.success} ok, ${bucket.error} failed)`}
                    >
                      {allZero || maxDaily === 0 ? (
                        <div className="h-0.5 w-full rounded-full bg-muted" />
                      ) : (
                        <>
                          {bucket.error > 0 && (
                            <div
                              className="w-full rounded-t-sm bg-red-400/70"
                              style={{ height: `${(bucket.error / maxDaily) * 100}%` }}
                            />
                          )}
                          {bucket.success > 0 && (
                            <div
                              className={cn('w-full bg-emerald-500/80', bucket.error === 0 && 'rounded-t-sm')}
                              style={{ height: `${(bucket.success / maxDaily) * 100}%` }}
                            />
                          )}
                        </>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{dayLabel(bucket.date)}</span>
                  </div>
                ))}
              </div>
              {allZero && (
                <p className="mt-3 text-center text-xs text-muted-foreground">No runs yet</p>
              )}
            </CardContent>
          </Card>

          {/* Recent runs */}
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>The latest executions across all of your flows.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Flow</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="pr-6 text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentRuns.map((run) => (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => onOpenRuns()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenRuns();
                        }
                      }}
                    >
                      <TableCell className="max-w-[180px] pl-6 font-medium">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left underline-offset-4 transition-colors hover:text-primary hover:underline"
                          title={run.flowName}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFlow(run.flowId);
                          }}
                        >
                          {run.flowName}
                        </button>
                      </TableCell>
                      <TableCell>
                        <TriggerSourceChip source={run.triggerType} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDuration(run.durationMs)}</TableCell>
                      <TableCell className="pr-6 text-right text-muted-foreground">
                        <RelativeTime iso={run.startedAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {stats.recentRuns.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">
                        No runs yet — trigger a flow to see it here.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
            <CardFooter className="border-t">
              <button
                type="button"
                onClick={onOpenRuns}
                className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline"
              >
                View all runs →
              </button>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
