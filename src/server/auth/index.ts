import type { AppUser } from '@/types';
import { isSupabaseMode } from '@/lib/env';
import { getLocalSessionUser } from './local';
import { createUserClient } from './supabase';

export interface AuthResult {
  user?: AppUser;
  needsConfirmation?: boolean;
  error?: string;
}

/** Resolve the current user from the session (cookie-based in both modes). */
export async function getSessionUser(): Promise<AppUser | null> {
  if (isSupabaseMode()) {
    try {
      const supabase = await createUserClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) return null;
      let name: string | null = data.user.user_metadata?.name ?? null;
      // fall back to the profiles table
      if (name == null) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', data.user.id)
          .maybeSingle();
        name = profile?.name ?? null;
      }
      return {
        id: data.user.id,
        email: data.user.email ?? '',
        name,
        createdAt: data.user.created_at,
      };
    } catch {
      return null;
    }
  }
  return getLocalSessionUser();
}

export async function authSignUp(email: string, password: string, name: string | null): Promise<AuthResult> {
  if (isSupabaseMode()) {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name ?? '' } },
    });
    if (error) return { error: friendlyAuthError(error.message) };
    if (!data.session) {
      // email confirmation is enabled in Supabase — no session until confirmed
      return { needsConfirmation: true };
    }
    return {
      user: {
        id: data.user!.id,
        email: data.user!.email ?? email,
        name: name ?? (data.user!.user_metadata?.name ?? null),
      },
    };
  }

  // local mode — delegate to the store which owns the users table
  const { localAuth } = await import('@/server/store/local-store');
  return localAuth.signUp(email, password, name);
}

export async function authSignIn(email: string, password: string): Promise<AuthResult> {
  if (isSupabaseMode()) {
    const supabase = await createUserClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error: friendlyAuthError(error?.message ?? 'Invalid credentials') };
    let name: string | null = data.user.user_metadata?.name ?? null;
    if (name == null) {
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', data.user.id).maybeSingle();
      name = profile?.name ?? null;
    }
    return { user: { id: data.user.id, email: data.user.email ?? email, name } };
  }

  const { localAuth } = await import('@/server/store/local-store');
  return localAuth.signIn(email, password);
}

export async function authSignOut(): Promise<void> {
  if (isSupabaseMode()) {
    const supabase = await createUserClient();
    await supabase.auth.signOut();
  }
  // local mode: cookie cleared by the route handler
}

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('already registered') || m.includes('already exists')) return 'An account with this email already exists.';
  if (m.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  if (m.includes('password should be')) return 'Password must be at least 8 characters.';
  if (m.includes('valid email')) return 'Please enter a valid email address.';
  return message;
}
