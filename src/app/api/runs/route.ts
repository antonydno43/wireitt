import { userStore } from '@/server/store';
import { requireUser, handle } from '@/server/guard';
import { jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(req.url);
    const flowId = url.searchParams.get('flowId') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 25)), 100);

    const store = await userStore();
    const result = await store.listRuns(user.id, { flowId, status, cursor, limit });
    return jsonNoStore(result);
  });
}
