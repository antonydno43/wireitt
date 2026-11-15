/** Build the public webhook URL for a flow token from the request origin. */
export function webhookUrlFor(req: Request, token: string | null): string | null {
  if (!token) return null;
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (envBase) return `${envBase}/api/hooks/${token}`;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!host) return `/api/hooks/${token}`;
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/hooks/${token}`;
}
