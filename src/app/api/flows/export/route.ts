import { userStore } from '@/server/store';
import { requireUser, handle } from '@/server/guard';
import { jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Export all of the user's flows (with graphs) as a JSON backup. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const store = await userStore();
    const flows = await store.exportFlows(user.id);
    const res = jsonNoStore({
      exportedAt: new Date().toISOString(),
      flows: flows.map(({ userId, webhookUrl, ...flow }) => flow),
    });
    res.headers.set('Content-Disposition', `attachment; filename="wireitt-flows-${Date.now()}.json"`);
    return res;
  });
}
