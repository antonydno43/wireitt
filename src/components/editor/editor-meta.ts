'use client';

import { createElement, type ReactElement } from 'react';
import {
  Bell,
  Braces,
  Clock,
  GitBranch,
  Globe,
  Play,
  Reply,
  Timer,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { NodeKind } from '@/types';

// ============================================================
// Palette metadata — drives the left palette, node cards, icons
// ============================================================

export interface PaletteItem {
  kind: NodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  category: 'trigger' | 'action';
}

export const PALETTE: PaletteItem[] = [
  { kind: 'trigger.manual', label: 'Manual trigger', description: 'Run on demand', icon: Play, category: 'trigger' },
  { kind: 'trigger.webhook', label: 'Webhook trigger', description: 'Run on an HTTP call', icon: Webhook, category: 'trigger' },
  { kind: 'trigger.schedule', label: 'Schedule trigger', description: 'Every N minutes / daily', icon: Clock, category: 'trigger' },
  { kind: 'action.http', label: 'HTTP request', description: 'Call any API', icon: Globe, category: 'action' },
  { kind: 'action.condition', label: 'Condition', description: 'Branch the flow', icon: GitBranch, category: 'action' },
  { kind: 'action.transform', label: 'Transform', description: 'Map to a new payload', icon: Braces, category: 'action' },
  { kind: 'action.delay', label: 'Delay', description: 'Wait N ms', icon: Timer, category: 'action' },
  { kind: 'action.respond', label: 'Respond', description: 'Custom webhook response', icon: Reply, category: 'action' },
  { kind: 'action.notify', label: 'Notification', description: 'Slack / Discord / Telegram', icon: Bell, category: 'action' },
];

export const NODE_DEFAULTS: Record<NodeKind, Record<string, unknown>> = {
  'trigger.manual': {},
  'trigger.webhook': {},
  'trigger.schedule': { mode: 'minutes', intervalMinutes: 5, time: '09:00' },
  'action.http': { method: 'GET', url: '', headers: [], body: '', timeoutMs: 10000 },
  'action.condition': { left: '', operator: 'eq', right: '' },
  'action.transform': { fields: [{ key: 'result', value: '{{trigger.payload}}' }] },
  'action.delay': { ms: 1000 },
  'action.respond': { status: 200, body: '{}' },
  'action.notify': { provider: 'slack', url: '', text: '', botToken: '', chatId: '' },
};

export const CATEGORY_COLORS: Record<'trigger' | 'action', string> = {
  trigger: 'bg-emerald-500/15 text-emerald-400',
  action: 'bg-zinc-800 text-zinc-300',
};

export function categoryOf(kind: NodeKind): 'trigger' | 'action' {
  return kind.startsWith('trigger.') ? 'trigger' : 'action';
}

const KIND_ICONS: Record<NodeKind, LucideIcon> = {
  'trigger.manual': Play,
  'trigger.webhook': Webhook,
  'trigger.schedule': Clock,
  'action.http': Globe,
  'action.condition': GitBranch,
  'action.transform': Braces,
  'action.delay': Timer,
  'action.respond': Reply,
  'action.notify': Bell,
};

const KIND_TITLES: Record<NodeKind, string> = {
  'trigger.manual': 'Manual trigger',
  'trigger.webhook': 'Webhook trigger',
  'trigger.schedule': 'Schedule trigger',
  'action.http': 'HTTP request',
  'action.condition': 'Condition',
  'action.transform': 'Transform',
  'action.delay': 'Delay',
  'action.respond': 'Respond',
  'action.notify': 'Notification',
};

export function nodeTitle(kind: NodeKind): string {
  return KIND_TITLES[kind] ?? kind;
}

export function nodeIcon(kind: NodeKind): LucideIcon {
  return KIND_ICONS[kind] ?? Zap;
}

/**
 * Rendered icon element for a node kind. Returns an element (not a component)
 * so consumers never create a component during render.
 */
export function nodeIconElement(kind: NodeKind, className?: string): ReactElement {
  return createElement(nodeIcon(kind), { className });
}

// ---------------- config readers (defensive — config comes from JSON) ----------------

function str(config: Record<string, unknown>, key: string, fallback = ''): string {
  const v = config[key];
  return typeof v === 'string' ? v : fallback;
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function truncate(text: string, max = 28): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'has',
  not_contains: 'not has',
  starts_with: 'starts',
  ends_with: 'ends',
  exists: 'exists',
  not_exists: 'missing',
};

const NOTIFY_PROVIDERS: Record<string, string> = {
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
  custom: 'Webhook',
};

function formatMs(ms: number): string {
  if (ms >= 1000) {
    const s = ms / 1000;
    return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function hostnameOf(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname;
  } catch {
    return url;
  }
}

/** Compact one-line subtitle for a node card. Keep it short. */
export function nodeSummary(kind: NodeKind, config: Record<string, unknown>): string {
  switch (kind) {
    case 'trigger.manual':
      return 'Runs on demand';
    case 'trigger.webhook':
      return 'Runs on HTTP call';
    case 'trigger.schedule': {
      const mode = str(config, 'mode', 'minutes');
      if (mode === 'daily') return `daily ${str(config, 'time', '09:00')}`;
      return `every ${num(config, 'intervalMinutes', 5)}m`;
    }
    case 'action.http': {
      const method = str(config, 'method', 'GET').toUpperCase();
      const host = hostnameOf(str(config, 'url'));
      return truncate(host ? `${method} ${host}` : method);
    }
    case 'action.condition': {
      const left = str(config, 'left');
      const op = OPERATOR_SYMBOLS[str(config, 'operator', 'eq')] ?? '=';
      const right = str(config, 'right');
      const compact = right ? `${left || '…'} ${op} ${right}` : `${left || '…'} ${op}`;
      return truncate(compact || 'not configured');
    }
    case 'action.transform': {
      const fields = config.fields;
      const count = Array.isArray(fields) ? fields.length : 0;
      return `${count} field${count === 1 ? '' : 's'}`;
    }
    case 'action.delay':
      return formatMs(num(config, 'ms', 1000));
    case 'action.respond':
      return `→ ${num(config, 'status', 200)}`;
    case 'action.notify': {
      const provider = NOTIFY_PROVIDERS[str(config, 'provider', 'slack')] ?? 'Slack';
      return truncate(`${provider} message`);
    }
    default:
      return '';
  }
}
