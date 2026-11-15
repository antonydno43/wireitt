import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@/lib/env';

/**
 * User-scoped Supabase client (anon key + user's JWT from cookies).
 * All data access through this client is constrained by Row Level Security.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a context where cookies cannot be mutated — safe to ignore
        }
      },
    },
  });
}

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role client. SERVER ONLY — bypasses RLS and must never be exposed
 * to the browser. Used exclusively for trusted server operations: webhook
 * execution, the cron scheduler and log retention.
 */
export function getServiceClient(): SupabaseClient {
  const { url, serviceKey } = supabaseEnv();
  if (!serviceClient) {
    serviceClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return serviceClient;
}
