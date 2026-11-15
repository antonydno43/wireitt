import type { DeploymentMode } from '@/types';

/**
 * WireItt runs in two modes:
 *  - "cloud":  Supabase (Postgres + Auth + RLS). Enabled when the three
 *              Supabase env vars are present. This is the production mode
 *              used on Vercel.
 *  - "local":  Prisma + SQLite with first-party session auth. Used for the
 *              bundled demo / self-host without Supabase.
 */
export function supabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  };
}

export function isSupabaseMode(): boolean {
  const { url, anonKey, serviceKey } = supabaseEnv();
  return Boolean(url && anonKey && serviceKey);
}

export function deploymentMode(): DeploymentMode {
  return isSupabaseMode() ? 'cloud' : 'local';
}

/** Secret used to sign local-mode sessions. Set APP_SECRET in production. */
export function appSecret(): string {
  return process.env.APP_SECRET || 'wireitt-local-dev-secret';
}

/** Whether HTTP action nodes may reach private/loopback IPs. */
export function allowPrivateHttp(): boolean {
  if (process.env.ENGINE_ALLOW_PRIVATE_HTTP === 'true') return true;
  if (process.env.ENGINE_ALLOW_PRIVATE_HTTP === 'false') return false;
  // Allowed in the local dev/demo sandbox, blocked in production by default (SSRF guard).
  return process.env.NODE_ENV !== 'production';
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

export function runLogRetentionDays(): number {
  const n = Number(process.env.RUN_LOG_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
