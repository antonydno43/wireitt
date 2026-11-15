'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Copy,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { FlowListItem } from '@/types';
import { deleteFlow, duplicateFlow, listFlows, runFlow, updateFlow } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, RelativeTime, StatusBadge, TriggerChip, formatDuration } from '@/components/app/shared';

type BusyAction = 'run' | 'toggle' | 'duplicate';

const PAGE_SIZE = 24;

function lastRunDotClass(status: FlowListItem['lastRunStatus']): string {
  if (!status) return 'bg-zinc-600';
  if (status === 'success') return 'bg-emerald-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-amber-400';
}

export function FlowsView({
  onEditFlow,
  onNewFlow,
}: {
  onEditFlow: (flowId: string) => void;
  onNewFlow: () => void;
}) {
  const [list, setList] = useState<FlowListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<Record<string, BusyAction | undefined>>({});
  const [deleteTarget, setDeleteTarget] = useState<FlowListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // debounce the search query
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const clearBusy = (flowId: string) =>
    setBusy((prev) => {
      if (prev[flowId] === undefined) return prev;
      const next = { ...prev };
      delete next[flowId];
      return next;
    });

  const load = useCallback(async (nextPage: number, query: string, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await listFlows({ page: nextPage, q: query || undefined, limit: PAGE_SIZE });
      setList((prev) =>
        append ? [...prev, ...res.items.filter((item) => !prev.some((p) => p.id === item.id))] : res.items
      );
      setTotal(res.total);
      setPage(nextPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load flows.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // initial load + reload whenever the debounced query changes
  useEffect(() => {
    load(1, debouncedQ, false);
  }, [load, debouncedQ]);

  async function runNow(flow: FlowListItem) {
    if (busy[flow.id]) return;
    setBusy((prev) => ({ ...prev, [flow.id]: 'run' }));
    try {
      const { run } = await runFlow(flow.id, null, 'manual');
      toast.success(
        run.durationMs != null ? `Flow ran in ${formatDuration(run.durationMs)}` : 'Flow ran.'
      );
      setList((prev) =>
        prev.map((f) =>
          f.id === flow.id
            ? { ...f, runCount: f.runCount + 1, lastRunAt: run.startedAt, lastRunStatus: run.status }
            : f
        )
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run the flow.');
    } finally {
      clearBusy(flow.id);
    }
  }

  async function toggleStatus(flow: FlowListItem) {
    if (busy[flow.id]) return;
    const nextStatus = flow.status === 'active' ? 'paused' : 'active';
    setBusy((prev) => ({ ...prev, [flow.id]: 'toggle' }));
    setList((prev) => prev.map((f) => (f.id === flow.id ? { ...f, status: nextStatus } : f)));
    try {
      await updateFlow(flow.id, { status: nextStatus });
      toast.success(nextStatus === 'active' ? 'Flow activated.' : 'Flow paused.');
    } catch (err) {
      setList((prev) => prev.map((f) => (f.id === flow.id ? { ...f, status: flow.status } : f)));
      toast.error(err instanceof Error ? err.message : 'Failed to update the flow.');
    } finally {
      clearBusy(flow.id);
    }
  }

  async function duplicate(flow: FlowListItem) {
    if (busy[flow.id]) return;
    setBusy((prev) => ({ ...prev, [flow.id]: 'duplicate' }));
    try {
      const { flow: copy } = await duplicateFlow(flow.id);
      setList((prev) => [copy, ...prev.filter((f) => f.id !== copy.id)]);
      setTotal((t) => t + 1);
      toast.success('Flow duplicated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate the flow.');
    } finally {
      clearBusy(flow.id);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFlow(deleteTarget.id);
      setList((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success('Flow deleted.');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the flow.');
    } finally {
      setDeleting(false);
    }
  }

  const searchActive = debouncedQ.trim() !== '';

  return (
    <div className="flex flex-col gap-6">
      {/* Header + toolbar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} {total === 1 ? 'flow' : 'flows'}
              {searchActive ? ` matching “${debouncedQ.trim()}”` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => load(1, debouncedQ, false)}
              aria-label="Refresh flows"
              className="shrink-0"
            >
              <RotateCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
            <Button onClick={onNewFlow} className="flex-1 sm:flex-none">
              <Plus className="size-4" />
              New flow
            </Button>
          </div>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search flows…"
            className="pl-9 pr-9"
            aria-label="Search flows"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content — skeletons only on the very first load; later refreshes keep the stale list */}
      {loading && list.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        searchActive ? (
          <EmptyState
            icon={Search}
            title={`No flows match “${debouncedQ.trim()}”`}
            description="Try a different search term or clear the search."
            action={
              <Button variant="outline" onClick={() => setQ('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Workflow}
            title="No flows yet"
            description="Create your first automation — wire a trigger to an action."
            action={
              <Button onClick={onNewFlow}>
                <Plus className="size-4" />
                New flow
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((flow) => {
              const isRunning = busy[flow.id] === 'run';
              return (
                <div
                  key={flow.id}
                  role="button"
                  tabIndex={0}
                  className="group cursor-pointer rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:outline-none"
                  onClick={() => onEditFlow(flow.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEditFlow(flow.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <TriggerChip type={flow.triggerType} />
                    <StatusBadge status={flow.status} />
                  </div>

                  <div className="mt-3 min-w-0">
                    <h3 className="truncate font-medium" title={flow.name}>
                      {flow.name}
                    </h3>
                    {flow.description ? (
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{flow.description}</p>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Activity className="size-3.5" />
                        {flow.runCount} runs
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lastRunDotClass(flow.lastRunStatus))} />
                        <RelativeTime iso={flow.lastRunAt} prefix="ran " />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        updated <RelativeTime iso={flow.updatedAt} />
                      </span>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                          aria-label={`Actions for ${flow.name}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          disabled={isRunning}
                          onSelect={(e) => {
                            e.preventDefault(); // keep the menu open so the spinner is visible
                            runNow(flow);
                          }}
                        >
                          {isRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                          {isRunning ? 'Running…' : 'Run now'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEditFlow(flow.id)}>
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => duplicate(flow)}>
                          <Copy className="size-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => toggleStatus(flow)}>
                          {flow.status === 'active' ? (
                            <Pause className="size-4" />
                          ) : (
                            <Play className="size-4" />
                          )}
                          {flow.status === 'active' ? 'Pause' : 'Activate'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(flow)}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>

          {list.length < total && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => load(page + 1, debouncedQ, true)} disabled={loadingMore}>
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete flow?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the flow and its run history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the delete finishes
                confirmDelete();
              }}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
