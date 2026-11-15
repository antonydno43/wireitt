import { userStore } from '@/server/store';
import { requireUser, handle, ApiError } from '@/server/guard';
import { jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 25)), 100);

    const store = await userStore();
    const flow = await store.getFlow(user.id, id);
    if (!flow) throw new ApiError(404, 'Flow not found');

    const result = await store.listRuns(user.id, { flowId: id, cursor, limit });
    return jsonNoStore(result);
  });
}
