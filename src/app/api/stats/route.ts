import { userStore } from '@/server/store';
import { requireUser, handle } from '@/server/guard';
import { jsonNoStore } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const store = await userStore();
    const stats = await store.stats(user.id);
    return jsonNoStore({ stats });
  });
}
