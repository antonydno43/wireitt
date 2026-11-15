'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  Waypoints,
  Workflow,
  Zap,
} from 'lucide-react';
import type { AppUser, DeploymentMode } from '@/types';
import { me, signOut } from '@/lib/api-client';
import { AuthView } from '@/components/app/auth-view';
import { DashboardView } from '@/components/app/dashboard-view';
import { FlowsView } from '@/components/app/flows-view';
import { RunsView } from '@/components/app/runs-view';
import { SettingsView } from '@/components/app/settings-view';
import { FlowEditor } from '@/components/editor/flow-editor';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { toast } from 'sonner';

type View = 'dashboard' | 'flows' | 'runs' | 'settings' | 'editor';

const NAV: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
        <Waypoints className="h-4.5 w-4.5" aria-hidden />
      </div>
      <span className="text-base font-semibold tracking-tight">
        Wire<span className="text-primary">Itt</span>
      </span>
    </div>
  );
}

function UserMenu({ user, onSignOut, onSettings }: { user: AppUser; onSignOut: () => void; onSettings: () => void }) {
  const initials = (user.name || user.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 w-9 rounded-full p-0" aria-label="Account menu">
          <span className="h-8 w-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold">
            {initials || 'U'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium truncate">{user.name || 'Account'}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSettings}>
          <SettingsIcon className="h-4 w-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut} variant="destructive">
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Home() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [mode, setMode] = useState<DeploymentMode>('local');
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setMode(res.mode);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // best effort — clear locally regardless
    }
    setUser(null);
    setView('dashboard');
    toast.success('Signed out');
  }, []);

  const go = useCallback((next: View) => {
    setView(next);
    setMobileNavOpen(false);
  }, []);

  const openEditor = useCallback((flowId: string | null) => {
    setEditingFlowId(flowId);
    setView('editor');
  }, []);

  if (booting) {
    return (
      <div className="min-h-screen bg-background grid place-items-center" role="status" aria-label="Loading WireItt">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary grid place-items-center animate-pulse">
            <Waypoints className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">Loading WireItt…</p>
        </div>
      </div>
    );
  }

  // ---------------- logged out ----------------
  if (!user) {
    return (
      <AuthView
        onSignedIn={(u) => {
          setUser(u);
          setView('dashboard');
        }}
      />
    );
  }

  // ---------------- logged in ----------------
  const isEditor = view === 'editor';

  const navList = (inSheet = false) => (
    <nav className={inSheet ? 'flex flex-col gap-1' : 'flex flex-col gap-1 px-3 py-4'} aria-label="Main navigation">
      {NAV.map((item) => {
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left ${
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
            {active && <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-60" aria-hidden />}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-14 border-b shrink-0 flex items-center gap-3 px-4 sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="h-14 border-b flex items-center px-4">
              <Logo />
            </div>
            {navList(true)}
          </SheetContent>
        </Sheet>

        <button type="button" onClick={() => go('dashboard')} className="hover:opacity-80 transition-opacity" aria-label="WireItt home">
          <Logo />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex h-9"
            onClick={() => openEditor(null)}
          >
            <Zap className="h-4 w-4" />
            New flow
          </Button>
          <UserMenu user={user} onSignOut={handleSignOut} onSettings={() => go('settings')} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (desktop) */}
        {!isEditor && (
          <aside className="hidden md:flex w-56 shrink-0 border-r flex-col bg-sidebar">
            {navList()}
            <div className="mt-auto p-4 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${mode === 'cloud' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  aria-hidden
                />
                {mode === 'cloud' ? 'Cloud · Supabase' : 'Local demo mode'}
              </div>
            </div>
          </aside>
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          {isEditor ? (
            <FlowEditor
              flowId={editingFlowId}
              onBack={() => go('flows')}
              onSaved={() => {
                /* flows/runs views refetch when visited */
              }}
            />
          ) : (
            <div className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 flex flex-col gap-6">
              {view === 'dashboard' && (
                <DashboardView
                  user={user}
                  onNewFlow={() => openEditor(null)}
                  onOpenFlow={(id) => openEditor(id)}
                  onOpenRuns={() => go('runs')}
                />
              )}
              {view === 'flows' && (
                <FlowsView onEditFlow={(id) => openEditor(id)} onNewFlow={() => openEditor(null)} />
              )}
              {view === 'runs' && <RunsView onOpenFlow={(id) => openEditor(id)} />}
              {view === 'settings' && <SettingsView user={user} mode={mode} onSignOut={handleSignOut} />}
            </div>
          )}
        </main>
      </div>

      {/* Status footer — pinned to the bottom, pushed down by long content */}
      {!isEditor && (
        <footer className="border-t mt-auto shrink-0">
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-10 flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="truncate">All systems operational · WireItt v1.0</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline">Automate the boring stuff</span>
              <span>© {new Date().getFullYear()}</span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
