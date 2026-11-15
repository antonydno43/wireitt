'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, ChevronRight, FlaskConical, History, Loader2, Play, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { FlowRun, RunLogEntry, RunStatus } from '@/types';
import { nodeIconElement } from './editor-meta';

// ============================================================
// Bottom test-run drawer: payload input + step-by-step results
// ============================================================

export interface RunPanelProps {
  open: boolean;
  onClose: () => void;
  running: boolean;
  payload: string;
  onPayloadChange: (v: string) => void;
  onRun: () => void;
  run: FlowRun | null;
  onFlowClick?: () => void;
}

// Local status badge (kept private — the shared one belongs to another agent's file)
function RunStatusBadge({ status }: { status: RunStatus }) {
  const styles: Record<RunStatus, string> = {
    running: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    error: 'border-red-500/40 bg-red-500/10 text-red-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
        styles[status]
      )}
    >
      {status}
    </span>
  );
}

function JsonBlock({ value, className }: { value?: unknown; className?: string }) {
  if (value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    text = String(value);
  }
  return (
    <pre
      className={cn(
        'max-h-40 overflow-auto rounded-md border bg-zinc-950/60 p-2 font-mono text-[10px] leading-relaxed text-zinc-300',
        className
      )}
    >
      {text}
    </pre>
  );
}

function LogRow({ log }: { log: RunLogEntry }) {
  const hasData = log.data !== undefined && log.data !== null;
  return (
    <Collapsible className="border-b border-border/60 pb-2 last:border-0">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
            log.level === 'success' && 'bg-emerald-500',
            log.level === 'error' && 'bg-red-500',
            log.level === 'info' && 'bg-zinc-500'
          )}
        />
        {nodeIconElement(log.nodeType as Parameters<typeof nodeIconElement>[0], 'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground')}
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs leading-snug">{log.message}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(log.at), { addSuffix: true })}
          </p>
        </div>
        {hasData && (
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle step data"
              className="group size-6 shrink-0 text-muted-foreground"
            >
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      {hasData && (
        <CollapsibleContent>
          <JsonBlock value={log.data} className="mt-1.5 ml-6" />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function RunPanel({
  open,
  onClose,
  running,
  payload,
  onPayloadChange,
  onRun,
  run,
  onFlowClick,
}: RunPanelProps) {
  const [viewOverride, setViewOverride] = useState<{ runId: string; view: 'payload' | 'results' } | null>(null);
  // Derived (no effect needed): show results once a run exists; a user toggle wins
  // until the next run replaces it.
  const mobileView: 'payload' | 'results' =
    viewOverride && run && viewOverride.runId === run.id
      ? viewOverride.view
      : run
        ? 'results'
        : 'payload';

  const trimmed = payload.trim();
  let payloadValid = true;
  if (trimmed) {
    try {
      JSON.parse(trimmed);
    } catch {
      payloadValid = false;
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          role="region"
          aria-label="Test run panel"
          className="absolute inset-x-0 bottom-0 z-20 flex h-[300px] flex-col rounded-t-xl border-t bg-card/95 shadow-2xl backdrop-blur"
        >
          {/* header */}
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Test run</span>
            {run && (
              <>
                <RunStatusBadge status={run.status} />
                {run.durationMs != null && (
                  <span className="text-xs text-muted-foreground">{run.durationMs}ms</span>
                )}
              </>
            )}
            <div className="ml-auto" />
            {/* payload / results toggle (mobile only — both columns visible on md+) */}
            <div
              role="tablist"
              aria-label="Test run views"
              className="flex items-center rounded-md border p-0.5 md:hidden"
            >
              {(['payload', 'results'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  role="tab"
                  aria-selected={mobileView === view}
                  onClick={() =>
                    setViewOverride(run ? { runId: run.id, view } : null)
                  }
                  className={cn(
                    'rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                    mobileView === view
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
            {onFlowClick && (
              <Button
                variant="ghost"
                size="sm"
                className="hidden text-xs text-muted-foreground sm:inline-flex"
                onClick={onFlowClick}
              >
                <History className="size-3.5" /> History
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Close test run panel"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* body */}
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 md:grid-cols-2">
            {/* LEFT — payload */}
            <div
              className={cn('min-h-0 flex-col gap-2', mobileView === 'payload' ? 'flex' : 'hidden md:flex')}
            >
              <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Trigger payload
              </Label>
              <Textarea
                aria-label="Trigger payload (JSON)"
                className="min-h-32 flex-1 resize-none font-mono text-xs"
                placeholder='{"body": {"hello": "world"}}'
                value={payload}
                onChange={(e) => onPayloadChange(e.target.value)}
              />
              <p className={cn('text-xs', payloadValid ? 'text-muted-foreground' : 'text-destructive')}>
                {payloadValid
                  ? 'JSON passed to the flow as {{trigger.payload}}'
                  : 'Payload must be valid JSON (or empty for null).'}
              </p>
              <div>
                <Button type="button" onClick={onRun} disabled={running || !payloadValid}>
                  {running ? <Loader2 className="animate-spin" /> : <Play className="size-4" />}
                  {running ? 'Running…' : 'Run flow'}
                </Button>
              </div>
            </div>

            {/* RIGHT — results */}
            <div
              className={cn('min-h-0 flex-col gap-2', mobileView === 'results' ? 'flex' : 'hidden md:flex')}
            >
              <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Results
              </Label>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {!run && (
                  <p className="pt-8 text-center text-xs text-muted-foreground">
                    Run the flow to see step-by-step results.
                  </p>
                )}
                {run && (
                  <>
                    {run.error && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Run failed</AlertTitle>
                        <AlertDescription>{run.error}</AlertDescription>
                      </Alert>
                    )}
                    {run.logs.length > 0 ? (
                      <div className="space-y-2">
                        {run.logs.map((log) => (
                          <LogRow key={log.id} log={log} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No logs were recorded for this run.</p>
                    )}
                    {run.output !== undefined && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Output</p>
                        <JsonBlock value={run.output} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
