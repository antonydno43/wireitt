/**
 * Runs once when the Next.js server boots.
 * In local/demo mode we start an in-process scheduler so Schedule triggers
 * work out of the box. On Vercel (cloud mode) scheduling is handled by
 * Vercel Cron hitting /api/cron/tick, so no interval is started there.
 */
export async function register() {
  console.log('[wireitt] instrumentation register() called, runtime =', process.env.NEXT_RUNTIME);
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.DISABLE_LOCAL_SCHEDULER === '1') return;

  const { isSupabaseMode } = await import('@/lib/env');
  if (isSupabaseMode()) return;

  const g = globalThis as unknown as { __wireittScheduler?: ReturnType<typeof setInterval> };
  if (g.__wireittScheduler) return;

  const { tickMaintenance } = await import('@/server/engine/scheduler');
  g.__wireittScheduler = setInterval(() => {
    tickMaintenance().catch((e) => console.error('[scheduler] tick failed', e));
  }, 30_000);
  g.__wireittScheduler.unref?.();
  console.log('[wireitt] local scheduler started (30s tick)');
}
