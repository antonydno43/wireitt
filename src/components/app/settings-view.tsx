'use client';

import { useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import {
  Bell,
  Braces,
  Clock,
  Download,
  GitBranch,
  Globe,
  LogOut,
  Play,
  Reply,
  Timer,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppUser, DeploymentMode } from '@/types';
import { exportFlowsUrl } from '@/lib/api-client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const NODE_REFERENCE: { name: string; icon: LucideIcon; blurb: string }[] = [
  { name: 'Manual trigger', icon: Play, blurb: 'Run on demand' },
  { name: 'Webhook trigger', icon: Webhook, blurb: 'Run when an HTTP call arrives' },
  { name: 'Schedule trigger', icon: Clock, blurb: 'Run every N minutes or daily' },
  { name: 'HTTP request', icon: Globe, blurb: 'Call any REST API' },
  { name: 'Condition', icon: GitBranch, blurb: 'Branch on a comparison' },
  { name: 'Transform', icon: Braces, blurb: 'Map fields into a new payload' },
  { name: 'Delay', icon: Timer, blurb: 'Pause between steps' },
  { name: 'Respond', icon: Reply, blurb: 'Custom response for webhooks' },
  { name: 'Notification', icon: Bell, blurb: 'Send Slack/Discord/Telegram messages' },
];

function initialsFor(user: AppUser): string {
  const name = user.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || user.email[0]?.toUpperCase() || '?';
  }
  return user.email[0]?.toUpperCase() ?? '?';
}

function ModeBadge({ mode }: { mode: DeploymentMode }) {
  if (mode === 'cloud') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Cloud · Supabase
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Local demo
    </span>
  );
}

export function SettingsView({
  user,
  mode,
  onSignOut,
}: {
  user: AppUser;
  mode: DeploymentMode;
  onSignOut: () => void;
}) {
  // window isn't available during SSR — read the origin client-side.
  // useSyncExternalStore re-reads the snapshot after hydration, so the
  // server renders "" first and the real origin appears right after mount
  // without a set-state-in-effect.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ''
  );

  let memberSince: string | null = null;
  if (user.createdAt) {
    const date = new Date(user.createdAt);
    if (!Number.isNaN(date.getTime())) {
      try {
        memberSince = format(date, 'MMMM yyyy');
      } catch {
        memberSince = null;
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account, webhooks and workspace data.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-6">
        {/* Account */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>Your WireItt identity and deployment mode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar className="size-12">
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {initialsFor(user)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name?.trim() || user.email}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                {memberSince && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Member since {memberSince}</p>
                )}
              </div>
              <ModeBadge mode={mode} />
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === 'cloud'
                ? 'You are signed in to the WireItt cloud — your account and flows are stored in Supabase, and new accounts confirm their email before signing in.'
                : 'WireItt is running in local demo mode — everything is stored on this machine and no email confirmation is required.'}
            </p>
          </CardContent>
        </Card>

        {/* Webhooks */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Webhooks</CardTitle>
            <CardDescription>Run flows from anywhere with a plain HTTP call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Every flow with a <span className="font-medium text-foreground">Webhook trigger</span> gets
              a unique URL, shown in the flow editor. Any GET or POST to it runs the flow immediately,
              with the request available as{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{'{ method, query, headers, body }'}</code>{' '}
              under{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">trigger.payload</code>.
            </p>
            <pre className="overflow-x-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">
              <span className="text-zinc-500"># your flow&apos;s unique webhook URL</span>
              {'\n'}
              {origin}
              {'/api/hooks/<token>'}
              {'\n\n'}
              <span className="text-zinc-500"># reference the request anywhere with templates</span>
              {'\n'}
              <span className="text-emerald-400">{'{{trigger.payload.body.email}}'}</span>
            </pre>
            <p className="text-xs text-muted-foreground">
              The flow must be <span className="font-medium text-emerald-400">Active</span> to accept
              calls.
            </p>
          </CardContent>
        </Card>

        {/* Node reference */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Node reference</CardTitle>
            <CardDescription>Everything you can wire together on the canvas.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {NODE_REFERENCE.map((node) => (
                <div key={node.name} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <node.icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{node.name}</p>
                    <p className="text-xs text-muted-foreground">{node.blurb}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Data */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Data</CardTitle>
            <CardDescription>Take your automations with you.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Downloads all flows with their graphs as JSON.</p>
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => {
                window.location.href = exportFlowsUrl();
              }}
            >
              <Download className="size-4" />
              Export my flows
            </Button>
          </CardContent>
        </Card>

        {/* Session */}
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">Session</CardTitle>
            <CardDescription>End your session on this device.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Sign out of WireItt.</p>
            <Button
              variant="outline"
              className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
