'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Braces,
  Clock,
  FlaskConical,
  GitBranch,
  Globe,
  Loader2,
  Play,
  Reply,
  Timer,
  Webhook,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { FlowStatus, NodeKind, RunStatus, TriggerSource } from '@/types';

// ---------------------------------------------------------------------------
// Trigger (node kind) metadata
// ---------------------------------------------------------------------------

export interface TriggerMetaEntry {
  label: string;
  icon: LucideIcon;
}

/** Map for trigger node kinds (and "no trigger") → { label, icon }. */
export const TRIGGER_META: {
  'trigger.manual': TriggerMetaEntry;
  'trigger.webhook': TriggerMetaEntry;
  'trigger.schedule': TriggerMetaEntry;
  null: TriggerMetaEntry;
} = {
  'trigger.manual': { label: 'Manual', icon: Play },
  'trigger.webhook': { label: 'Webhook', icon: Webhook },
  'trigger.schedule': { label: 'Schedule', icon: Clock },
  null: { label: 'No trigger', icon: Workflow },
};

/** Safe lookup for any node kind (falls back to "No trigger"). */
export function triggerMeta(type: NodeKind | null): TriggerMetaEntry {
  if (type === null) return TRIGGER_META.null;
  const entry = (TRIGGER_META as Record<string, TriggerMetaEntry | undefined>)[type];
  return entry ?? TRIGGER_META.null;
}

export function triggerLabel(type: NodeKind | null): string {
  return triggerMeta(type).label;
}

/** Small bordered chip showing a flow's trigger type. */
export function TriggerChip({ type }: { type: NodeKind | null }) {
  const meta = triggerMeta(type);
  const Icon = meta.icon;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Run trigger source metadata
// ---------------------------------------------------------------------------

export const TRIGGER_SOURCE_META: Record<TriggerSource, { label: string; icon: LucideIcon }> = {
  manual: { label: 'Manual', icon: Play },
  webhook: { label: 'Webhook', icon: Webhook },
  schedule: { label: 'Schedule', icon: Clock },
  test: { label: 'Test', icon: FlaskConical },
};

/** Small badge showing how a run was triggered. */
export function TriggerSourceChip({ source }: { source: TriggerSource }) {
  const meta = TRIGGER_SOURCE_META[source] ?? TRIGGER_SOURCE_META.manual;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon className="size-3 shrink-0" />
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Node icons (used in run timelines and the settings node reference)
// ---------------------------------------------------------------------------

export function nodeIcon(type: string): LucideIcon {
  switch (type) {
    case 'trigger.manual':
      return Play;
    case 'trigger.webhook':
      return Webhook;
    case 'trigger.schedule':
      return Clock;
    case 'action.http':
      return Globe;
    case 'action.condition':
      return GitBranch;
    case 'action.transform':
      return Braces;
    case 'action.delay':
      return Timer;
    case 'action.respond':
      return Reply;
    case 'action.notify':
      return Bell;
    default:
      return Workflow;
  }
}

/**
 * Lint-safe icon renderer for node types (`react-hooks/static-components`
 * rejects `const Icon = nodeIcon(...)` inside components — use this instead).
 */
export function NodeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'trigger.manual':
      return <Play className={className} />;
    case 'trigger.webhook':
      return <Webhook className={className} />;
    case 'trigger.schedule':
      return <Clock className={className} />;
    case 'action.http':
      return <Globe className={className} />;
    case 'action.condition':
      return <GitBranch className={className} />;
    case 'action.transform':
      return <Braces className={className} />;
    case 'action.delay':
      return <Timer className={className} />;
    case 'action.respond':
      return <Reply className={className} />;
    case 'action.notify':
      return <Bell className={className} />;
    default:
      return <Workflow className={className} />;
  }
}

// ---------------------------------------------------------------------------
// Status badge (runs: success/error/running — flows: active/paused)
// ---------------------------------------------------------------------------

export type StatusKind = RunStatus | FlowStatus;

const STATUS_STYLES: Record<StatusKind, { label: string; chip: string; dot: string; text: string }> = {
  success: { label: 'Success', chip: 'border-emerald-500/25 bg-emerald-500/10', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  error: { label: 'Error', chip: 'border-red-500/25 bg-red-500/10', dot: 'bg-red-400', text: 'text-red-400' },
  running: { label: 'Running', chip: 'border-amber-500/25 bg-amber-500/10', dot: 'bg-amber-400', text: 'text-amber-400' },
  active: { label: 'Active', chip: 'border-emerald-500/25 bg-emerald-500/10', dot: 'bg-emerald-500', text: 'text-emerald-500' },
  paused: { label: 'Paused', chip: 'border-zinc-500/25 bg-zinc-500/10', dot: 'bg-zinc-500', text: 'text-zinc-500' },
};

export function StatusBadge({ status }: { status: StatusKind }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.paused;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
        s.chip,
        s.text
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

export function RelativeTime({ iso, prefix }: { iso: string | null; prefix?: string }) {
  if (!iso) return <span aria-label="Unknown time">&mdash;</span>;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return <span aria-label="Unknown time">&mdash;</span>;
  let title = '';
  try {
    title = format(date, 'PPpp');
  } catch {
    title = iso;
  }
  return (
    <span title={title}>
      {prefix}
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export type StatTone = 'default' | 'success' | 'warning' | 'error';

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
}) {
  const toneClass: Record<StatTone, string> = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-emerald-500/10 text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-400',
    error: 'bg-red-500/10 text-red-400',
  };
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-4">
        <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', toneClass[tone])}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold leading-none tracking-tight">{value}</div>
          <div className="mt-1.5 truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
      {hint ? <p className="mt-3 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON block
// ---------------------------------------------------------------------------

export function JsonBlock({ value, maxHeight = '20rem' }: { value: unknown; maxHeight?: string }) {
  let text: string;
  if (value === undefined) {
    text = 'null';
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return (
    <pre
      className="overflow-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Page loader
// ---------------------------------------------------------------------------

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duration formatting ("340ms", "1.2s", "2m 10s")
// ---------------------------------------------------------------------------

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 0) return '—';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
