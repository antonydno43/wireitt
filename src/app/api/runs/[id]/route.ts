import { userStore } from '@/server/store';
import { requireUser, handle, ApiError } from '@/server/guard';
import { jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const store = await userStore();
    const run = await store.getRun(user.id, id);
    if (!run) throw new ApiError(404, 'Run not found');
    return jsonNoStore({ run });
  });
}
