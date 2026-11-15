'use client';

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeKind } from '@/types';
import { CATEGORY_COLORS, categoryOf, nodeIconElement, nodeSummary, nodeTitle } from './editor-meta';

// ============================================================
// WireItt custom node — a single card-style node for every kind
// ============================================================

export type WireIttNodeData = {
  kind: NodeKind;
  config: Record<string, unknown>;
  /** Set after a test run; cleared on edit. */
  runStatus?: 'success' | 'error' | 'skipped';
};

export type WireIttNode = Node<WireIttNodeData, 'wireitt'>;

const HANDLE_BASE =
  '!h-3 !w-3 !rounded-full !bg-zinc-500 !border-2 !border-zinc-900 hover:!bg-primary transition-colors';

function WireIttNodeInner({ data, selected }: NodeProps<WireIttNode>) {
  const { kind, config, runStatus } = data;
  const category = categoryOf(kind);
  const isTrigger = kind.startsWith('trigger.');
  const isCondition = kind === 'action.condition';

  return (
    <div
      className={cn(
        'relative w-[230px] rounded-xl border bg-card shadow-sm transition-opacity',
        selected && 'border-primary ring-1 ring-primary/60',
        runStatus === 'success' && 'border-emerald-500 ring-1 ring-emerald-500/60',
        runStatus === 'error' && 'border-red-500 ring-1 ring-red-500/60',
        runStatus === 'skipped' && 'opacity-40'
      )}
    >
      {runStatus === 'success' && (
        <span
          aria-label="Step succeeded"
          className="absolute -top-1.5 -right-1.5 z-10 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-black"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
      {runStatus === 'error' && (
        <span
          aria-label="Step failed"
          className="absolute -top-1.5 -right-1.5 z-10 grid h-4 w-4 place-items-center rounded-full bg-red-500 text-black"
        >
          <X className="h-3 w-3" strokeWidth={3} />
        </span>
      )}

      <div className="flex items-center gap-2.5 p-3">
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
            CATEGORY_COLORS[category]
          )}
        >
          {nodeIconElement(kind, 'h-4 w-4')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{nodeTitle(kind)}</p>
          <p className="truncate text-[11px] text-muted-foreground">{nodeSummary(kind, config)}</p>
        </div>
      </div>

      {/* Input — triggers never receive connections */}
      {!isTrigger && (
        <Handle type="target" position={Position.Left} className={HANDLE_BASE} />
      )}

      {/* Outputs */}
      {isCondition ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: '30%' }}
            className={cn(HANDLE_BASE, '!bg-emerald-500 hover:!bg-emerald-400')}
          />
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-[30%] -translate-y-1/2 text-[9px] font-medium text-emerald-400">
            true
          </span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: '70%' }}
            className={cn(HANDLE_BASE, '!bg-red-500 hover:!bg-red-400')}
          />
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-[70%] -translate-y-1/2 text-[9px] font-medium text-red-400">
            false
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className={HANDLE_BASE} />
      )}
    </div>
  );
}

/** Must stay at module level so React Flow never remounts the nodes. */
export const nodeTypes = { wireitt: memo(WireIttNodeInner) };
