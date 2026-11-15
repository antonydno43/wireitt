import { getSessionUser } from '@/server/auth';
import { jsonNoStore } from '@/server/security';
import { handle } from '@/server/guard';
import { deploymentMode } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    return jsonNoStore({ user, mode: deploymentMode() });
  });
}
