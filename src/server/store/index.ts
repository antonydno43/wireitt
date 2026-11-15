import { isSupabaseMode } from '@/lib/env';
import type { SystemStore, UserStore } from './types';

/**
 * Store facade. Picks the implementation at call time so the correct
 * backend is active for the current deployment and the other one is never
 * even imported (keeps Prisma off serverless Supabase builds).
 */
export async function userStore(): Promise<UserStore> {
  if (isSupabaseMode()) {
    const m = await import('./supabase-store');
    return m.supabaseUserStore;
  }
  const m = await import('./local-store');
  return m.localUserStore;
}

export async function systemStore(): Promise<SystemStore> {
  if (isSupabaseMode()) {
    const m = await import('./supabase-store');
    return m.supabaseSystemStore;
  }
  const m = await import('./local-store');
  return m.localSystemStore;
}

export type { FlowPatch, FlowRecord, ListRunsOptions } from './types';
