'use client';

import {
  Copy,
  Info,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { WireIttNode } from './flow-nodes';
import { CATEGORY_COLORS, categoryOf, nodeIconElement, nodeTitle } from './editor-meta';

// ============================================================
// Right-hand configuration panel for the selected node
// ============================================================

export interface PropsPanelProps {
  node: WireIttNode;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
  webhookUrl: string | null;
  flowSaved: boolean;
}

// ---------------- defensive config readers ----------------

function cfgStr(config: Record<string, unknown>, key: string, fallback = ''): string {
  const v = config[key];
  return typeof v === 'string' ? v : fallback;
}

function cfgNum(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function cfgPairs(config: Record<string, unknown>, key: string): { key: string; value: string }[] {
  const v = config[key];
  if (!Array.isArray(v)) return [];
  return v.filter(
    (row): row is { key: string; value: string } =>
      !!row && typeof row === 'object' && typeof (row as { key?: unknown }).key === 'string' && typeof (row as { value?: unknown }).value === 'string'
  );
}

const TEMPLATE_HELP = 'Use {{trigger.payload}} and {{steps.<node>.output}} to reference data from earlier steps.';

const OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: 'is equal to' },
  { value: 'ne', label: 'is not equal to' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'exists', label: 'exists' },
  { value: 'not_exists', label: 'does not exist' },
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const METHODS_WITH_BODY: readonly string[] = ['POST', 'PUT', 'PATCH'];
const NOTIFY_PROVIDERS: { value: string; label: string }[] = [
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'custom', label: 'Custom webhook' },
];

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Could not copy to clipboard');
  }
}

// ---------------- small layout helpers ----------------

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border bg-background/60 p-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px] text-zinc-300">
      {children}
    </code>
  );
}

function PairRowsEditor({
  label,
  rows,
  keyPlaceholder,
  valuePlaceholder,
  onChange,
  addLabel,
}: {
  label: string;
  rows: { key: string; value: string }[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  onChange: (rows: { key: string; value: string }[]) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              aria-label={`${label} key ${i + 1}`}
              placeholder={keyPlaceholder}
              value={row.key}
              className="h-8 text-xs"
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...row, key: e.target.value };
                onChange(next);
              }}
            />
            <Input
              aria-label={`${label} value ${i + 1}`}
              placeholder={valuePlaceholder}
              value={row.value}
              className="h-8 font-mono text-xs"
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...row, value: e.target.value };
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${label.toLowerCase()} row ${i + 1}`}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          <Plus className="size-3.5" /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Panel
// ============================================================

export function PropsPanel({ node, onChange, onDelete, onClose, webhookUrl, flowSaved }: PropsPanelProps) {
  const { kind, config } = node.data;

  return (
    <div className="flex h-full w-80 flex-col overflow-y-auto border-l bg-card lg:w-96">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 border-b bg-card px-4 py-3">
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
            CATEGORY_COLORS[categoryOf(kind)]
          )}
        >
          {nodeIconElement(kind, 'h-4 w-4')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{nodeTitle(kind)}</p>
          <p className="text-[11px] text-muted-foreground">Node settings</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete node"
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Close panel"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 space-y-4 p-4">
        {/* ---------------- triggers ---------------- */}
        {kind === 'trigger.manual' && (
          <Help>
            Runs when you click <span className="font-medium text-foreground">Test run</span> with a sample
            payload. Use it to design and debug the rest of the flow.
          </Help>
        )}

        {kind === 'trigger.webhook' && (
          <>
            {flowSaved && webhookUrl ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook URL</Label>
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-md border bg-zinc-950/60 px-2.5 py-2 font-mono text-[11px] text-zinc-300">
                    {webhookUrl}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0"
                    aria-label="Copy webhook URL"
                    onClick={() => copyText(webhookUrl, 'Webhook URL copied')}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Any GET/POST to this URL runs the flow. Access data via{' '}
                  <Code>{'{{trigger.payload.body}}'}</Code>, <Code>{'{{trigger.payload.query.x}}'}</Code>.
                </p>
              </div>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Webhook not ready</AlertTitle>
                <AlertDescription>Save the flow to get its webhook URL.</AlertDescription>
              </Alert>
            )}
          </>
        )}

        {kind === 'trigger.schedule' && (
          <>
            <Field label="Mode" htmlFor="schedule-mode">
              <Select
                value={cfgStr(config, 'mode', 'minutes') === 'daily' ? 'daily' : 'minutes'}
                onValueChange={(v) => onChange({ ...config, mode: v })}
              >
                <SelectTrigger id="schedule-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Every N minutes</SelectItem>
                  <SelectItem value="daily">Daily at</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {cfgStr(config, 'mode', 'minutes') === 'daily' ? (
              <Field label="Time (UTC)" htmlFor="schedule-time">
                <Input
                  id="schedule-time"
                  type="time"
                  value={cfgStr(config, 'time', '09:00')}
                  onChange={(e) => onChange({ ...config, time: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="Interval (minutes)" htmlFor="schedule-interval">
                <Input
                  id="schedule-interval"
                  type="number"
                  min={1}
                  value={cfgNum(config, 'intervalMinutes', 5)}
                  onChange={(e) =>
                    onChange({ ...config, intervalMinutes: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                  }
                />
              </Field>
            )}
            <Help>Scheduled flows must be Active. Runs are dispatched by the platform scheduler (UTC).</Help>
          </>
        )}

        {/* ---------------- action.http ---------------- */}
        {kind === 'action.http' && (
          <>
            <Field label="Method" htmlFor="http-method">
              <Select
                value={cfgStr(config, 'method', 'GET')}
                onValueChange={(v) => onChange({ ...config, method: v })}
              >
                <SelectTrigger id="http-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="URL" htmlFor="http-url" hint={TEMPLATE_HELP}>
              <Input
                id="http-url"
                placeholder="https://api.example.com/users/1"
                value={cfgStr(config, 'url')}
                className="font-mono text-xs"
                onChange={(e) => onChange({ ...config, url: e.target.value })}
              />
            </Field>
            <PairRowsEditor
              label="Headers"
              rows={cfgPairs(config, 'headers')}
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              addLabel="Add header"
              onChange={(headers) => onChange({ ...config, headers })}
            />
            {METHODS_WITH_BODY.includes(cfgStr(config, 'method', 'GET')) && (
              <Field label="Body" htmlFor="http-body">
                <Textarea
                  id="http-body"
                  className="min-h-24 font-mono text-xs"
                  placeholder={'{"note": "{{trigger.payload.body.title}}"}'}
                  value={cfgStr(config, 'body')}
                  onChange={(e) => onChange({ ...config, body: e.target.value })}
                />
              </Field>
            )}
            <Field label="Timeout (ms)" htmlFor="http-timeout">
              <Input
                id="http-timeout"
                type="number"
                min={1000}
                max={10000}
                value={cfgNum(config, 'timeoutMs', 10000)}
                onChange={(e) => onChange({ ...config, timeoutMs: Number(e.target.value) })}
              />
            </Field>
          </>
        )}

        {/* ---------------- action.condition ---------------- */}
        {kind === 'action.condition' && (
          <>
            <Field label="Left value" htmlFor="condition-left" hint={TEMPLATE_HELP}>
              <Input
                id="condition-left"
                placeholder="{{trigger.payload.body.status}}"
                value={cfgStr(config, 'left')}
                className="font-mono text-xs"
                onChange={(e) => onChange({ ...config, left: e.target.value })}
              />
            </Field>
            <Field label="Operator" htmlFor="condition-operator">
              <Select
                value={cfgStr(config, 'operator', 'eq')}
                onValueChange={(v) => onChange({ ...config, operator: v })}
              >
                <SelectTrigger id="condition-operator" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Right value" htmlFor="condition-right">
              <Input
                id="condition-right"
                placeholder="active"
                value={cfgStr(config, 'right')}
                className="font-mono text-xs"
                disabled={cfgStr(config, 'operator', 'eq') === 'exists' || cfgStr(config, 'operator', 'eq') === 'not_exists'}
                onChange={(e) => onChange({ ...config, right: e.target.value })}
              />
            </Field>
            <Help>
              Continue on the <span className="font-medium text-emerald-400">true (green)</span> or{' '}
              <span className="font-medium text-red-400">false (red)</span> output.
            </Help>
          </>
        )}

        {/* ---------------- action.transform ---------------- */}
        {kind === 'action.transform' && (
          <>
            <PairRowsEditor
              label="Output fields"
              rows={cfgPairs(config, 'fields')}
              keyPlaceholder="result"
              valuePlaceholder="{{trigger.payload}}"
              addLabel="Add field"
              onChange={(fields) => onChange({ ...config, fields })}
            />
            <Help>{TEMPLATE_HELP} The mapped object becomes this step&apos;s output.</Help>
          </>
        )}

        {/* ---------------- action.delay ---------------- */}
        {kind === 'action.delay' && (
          <Field label="Wait (ms)" htmlFor="delay-ms" hint="Pause the branch before continuing (100–30000 ms).">
            <Input
              id="delay-ms"
              type="number"
              min={100}
              max={30000}
              value={cfgNum(config, 'ms', 1000)}
              onChange={(e) => onChange({ ...config, ms: Number(e.target.value) })}
            />
          </Field>
        )}

        {/* ---------------- action.respond ---------------- */}
        {kind === 'action.respond' && (
          <>
            <Field label="HTTP status" htmlFor="respond-status">
              <Input
                id="respond-status"
                type="number"
                min={200}
                max={599}
                value={cfgNum(config, 'status', 200)}
                onChange={(e) => onChange({ ...config, status: Number(e.target.value) })}
              />
            </Field>
            <Field label="Body" htmlFor="respond-body" hint={TEMPLATE_HELP}>
              <Textarea
                id="respond-body"
                className="min-h-24 font-mono text-xs"
                placeholder={'{"ok": true, "received": "{{trigger.payload.body}}"}'}
                value={cfgStr(config, 'body', '{}')}
                onChange={(e) => onChange({ ...config, body: e.target.value })}
              />
            </Field>
            <Help>The last Respond node in the flow defines the HTTP response of the webhook trigger.</Help>
          </>
        )}

        {/* ---------------- action.notify ---------------- */}
        {kind === 'action.notify' && (
          <>
            <Field label="Provider" htmlFor="notify-provider">
              <Select
                value={cfgStr(config, 'provider', 'slack')}
                onValueChange={(v) => onChange({ ...config, provider: v })}
              >
                <SelectTrigger id="notify-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTIFY_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {cfgStr(config, 'provider', 'slack') !== 'telegram' && (
              <Field label="Incoming webhook URL" htmlFor="notify-url">
                <Input
                  id="notify-url"
                  placeholder="https://hooks.slack.com/services/…"
                  value={cfgStr(config, 'url')}
                  className="font-mono text-xs"
                  onChange={(e) => onChange({ ...config, url: e.target.value })}
                />
              </Field>
            )}
            {cfgStr(config, 'provider', 'slack') === 'telegram' && (
              <>
                <Field label="Bot token" htmlFor="notify-bot-token">
                  <Input
                    id="notify-bot-token"
                    placeholder="123456:ABC-DEF…"
                    value={cfgStr(config, 'botToken')}
                    className="font-mono text-xs"
                    onChange={(e) => onChange({ ...config, botToken: e.target.value })}
                  />
                </Field>
                <Field label="Chat ID" htmlFor="notify-chat-id">
                  <Input
                    id="notify-chat-id"
                    placeholder="-1001234567890"
                    value={cfgStr(config, 'chatId')}
                    className="font-mono text-xs"
                    onChange={(e) => onChange({ ...config, chatId: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="Message" htmlFor="notify-text" hint={TEMPLATE_HELP}>
              <Textarea
                id="notify-text"
                className="min-h-24 text-xs"
                placeholder="New order from {{trigger.payload.body.customer}}!"
                value={cfgStr(config, 'text')}
                onChange={(e) => onChange({ ...config, text: e.target.value })}
              />
            </Field>
            <Help>Creates an incoming-webhook message with the text above.</Help>
          </>
        )}
      </div>
    </div>
  );
}
