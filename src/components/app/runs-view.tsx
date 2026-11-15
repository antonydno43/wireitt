'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Activity, ChevronDown, ChevronRight, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import type { FlowListItem, FlowRun, FlowRunSummary, RunLogEntry } from '@/types';
import { getRun, listFlows, listRuns } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  EmptyState,
  JsonBlock,
  NodeIcon,
  RelativeTime,
  StatusBadge,
  TriggerSourceChip,
  formatDuration,
} from '@/components/app/shared';

const PAGE_SIZE = 25;

function formatStarted(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return format(date, 'PP pp');
  } catch {
    return iso;
  }
}

function levelDotClass(level: RunLogEntry['level']): string {
  if (level === 'success') return 'bg-emerald-400';
  if (level === 'error') return 'bg-red-400';
  return 'bg-zinc-500';
}

/** One timeline row in the run detail sheet. */
function LogRow({ entry }: { entry: RunLogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative border-l border-border pb-5 pl-5 last:pb-0">
      <span
        className={cn(
          'absolute -left-[3.5px] top-1.5 size-2 rounded-full',
          levelDotClass(entry.level)
        )}
      />
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted">
          <NodeIcon type={entry.nodeType} className="size-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm">{entry.message}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{entry.nodeType}</span>
            <span aria-hidden>·</span>
            <RelativeTime iso={entry.at} />
          </p>
          {entry.data != null && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={open}
              >
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {open ? 'Hide data' : 'Show data'}
              </button>
              {open && (
                <div className="mt-2">
                  <JsonBlock value={entry.data} maxHeight="16rem" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RunsView({
  flowId,
  onOpenFlow,
}: {
  flowId?: string;
  onOpenFlow?: (flowId: string) => void;
}) {
  const [flowFilter, setFlowFilter] = useState<string>(flowId ?? 'all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [items, setItems] = useState<FlowRunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // flow options for the filter select
  useEffect(() => {
    listFlows({ limit: 100 })
      .then((res) => setFlows(res.items))
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (cursor: string | null, silent: boolean) => {
      if (!silent) {
        if (cursor) setLoadingMore(true);
        else setLoading(true);
      }
      try {
        const res = await listRuns({
          flowId: flowFilter === 'all' ? undefined : flowFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          cursor,
          limit: PAGE_SIZE,
        });
        setItems((prev) => (cursor ? [...prev, ...res.items.filter((i) => !prev.some((p) => p.id === i.id))] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to load runs.');
      } finally {
        if (!silent) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [flowFilter, statusFilter]
  );

  // reload whenever filters change (also resets the cursor)
  useEffect(() => {
    load(null, false);
  }, [load]);

  // auto-refresh every 15s while the tab is visible
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load(null, true);
    }, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // load the run detail whenever a run is selected
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    getRun(selectedId)
      .then((res) => {
        if (!cancelled) setDetail(res.run);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load the run.');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Execution history across your flows. Click a run to inspect it.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={flowFilter} onValueChange={setFlowFilter}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Filter by flow">
              <SelectValue placeholder="All flows">
                {flowFilter === 'all'
                  ? 'All flows'
                  : (flows.find((f) => f.id === flowFilter)?.name ?? 'Selected flow')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flows</SelectItem>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Auto refresh" />
              Auto
            </label>
            <Button
              variant="outline"
              size="icon"
              onClick={() => load(null, false)}
              aria-label="Refresh runs"
            >
              <RotateCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>

      {/* Table — skeletons only when there is nothing to show yet */}
      {loading && items.length === 0 ? (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No runs yet"
          description="Run a flow manually or trigger a webhook to see history here."
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Status</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="pr-6">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelectedId(run.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(run.id);
                    }
                  }}
                >
                  <TableCell className="pl-6">
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    {onOpenFlow ? (
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium underline-offset-4 transition-colors hover:text-primary hover:underline"
                        title={run.flowName}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFlow(run.flowId);
                        }}
                      >
                        {run.flowName}
                      </button>
                    ) : (
                      <span className="block max-w-full truncate font-medium" title={run.flowName}>
                        {run.flowName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <TriggerSourceChip source={run.triggerType} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime iso={run.startedAt} />
                  </TableCell>
                  <TableCell className="pr-6 text-muted-foreground">
                    {run.durationMs == null ? '—' : formatDuration(run.durationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {nextCursor && (
            <div className="flex justify-center border-t p-4">
              <Button
                variant="outline"
                onClick={() => load(nextCursor, false)}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Run detail sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        >
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle className="flex items-center gap-3 pr-6">
              {detail && <StatusBadge status={detail.status} />}
              <span className="truncate">{detail ? detail.flowName : 'Run details'}</span>
            </SheetTitle>
            <SheetDescription>
              {detail ? (
                <>
                  Triggered via {detail.triggerType} · <RelativeTime iso={detail.startedAt} />
                </>
              ) : (
                'Execution details'
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailLoading || !detail ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-24 w-full rounded-lg" />
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Meta */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Started</p>
                    <p className="mt-1 text-sm">{formatStarted(detail.startedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="mt-1 text-sm">{formatDuration(detail.durationMs)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Trigger</p>
                    <p className="mt-1">
                      <TriggerSourceChip source={detail.triggerType} />
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Run ID</p>
                    <p className="mt-1 truncate font-mono text-xs" title={detail.id}>
                      {detail.id}
                    </p>
                  </div>
                </div>

                {/* Error */}
                {detail.error && (
                  <Alert variant="destructive">
                    <AlertTitle>Run failed</AlertTitle>
                    <AlertDescription>{detail.error}</AlertDescription>
                  </Alert>
                )}

                {/* Input */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Input</h3>
                  <JsonBlock value={detail.input} />
                </section>

                {/* Output */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Output</h3>
                  <JsonBlock value={detail.output} />
                </section>

                {/* Steps */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Steps</h3>
                  {detail.logs.length > 0 ? (
                    <div>
                      {detail.logs.map((entry) => (
                        <LogRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No step logs were recorded.</p>
                  )}
                </section>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
