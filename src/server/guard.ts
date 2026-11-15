import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { AppUser } from '@/types';
import { getSessionUser } from '@/server/auth';
import { jsonError } from '@/server/security';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<AppUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'Authentication required');
  return user;
}

/** Wrap a route handler with uniform error responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return jsonError(e.message, e.status);
    if (e instanceof ZodError) {
      const issue = e.issues[0];
      const path = issue?.path?.join('.') ?? '';
      return jsonError(`Invalid request${path ? ` (${path})` : ''}: ${issue?.message ?? 'validation failed'}`, 400);
    }
    console.error('[api] unhandled error', e);
    return jsonError('Something went wrong on our side. Please try again.', 500);
  }
}

export function parsePagination(url: URL): { page: number; limit: number } {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 50)), 100);
  return { page, limit };
}
