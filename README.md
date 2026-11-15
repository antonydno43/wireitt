# WireItt

**Visual automation flows as a service** — wire triggers to actions on a canvas, template data between steps, and watch every run execute live.

**Next.js 16** · **React 19** · **TypeScript** · **Tailwind CSS 4** · **Supabase (Postgres + Auth + RLS)** · **Vercel**

---

## What is WireItt?

WireItt is a visual automation platform. You build flows on a drag & drop canvas by connecting a trigger — **Manual**, **Webhook**, or **Schedule** — to a chain of action nodes: **HTTP request**, **Condition** (branching), **Transform**, **Delay**, **Respond** (custom webhook response), and **Notify** (Slack / Discord / Telegram). No code required; the graph is the program.

Data flows through the run context and is templated into any node field with `{{trigger.payload}}` and `{{steps.<node>.output}}` — so the output of one step becomes the input of the next. Every execution is recorded as a run with full history: per-step status, inputs/outputs, timing, and per-node logs, viewable in the run detail view. Webhook-triggered flows each get a unique URL with a 160-bit random token; scheduled flows run automatically every minute via a cron tick.

## Features

- ✅ **Auth** — email & password sign-up/sign-in (Supabase Auth in cloud mode)
- ✅ **Flow CRUD + visual editor** — drag & drop canvas, branching, node config panel, live test runs with per-node status
- ✅ **Webhook triggers** — unique URL per flow (`/api/hooks/<token>`) with custom status/body responses
- ✅ **Schedules** — every-N-minutes or daily at a fixed time
- ✅ **Execution engine** — SSRF guard, per-node timeouts, rate limits, 50s run deadline, 100-node cap
- ✅ **Run history + logs** — keyset-paginated history, per-step results, per-node log stream
- ✅ **Dashboard analytics** — totals, 24h activity, success rate, 7-day chart, recent runs
- ✅ **Export flows** — download all flows as JSON
- ✅ **Row Level Security** on every table — users only ever see their own rows
- ✅ **Dual-mode architecture** — Supabase cloud (production) or local SQLite demo, auto-selected by env vars

## Architecture

| | Cloud (production) | Local demo |
|---|---|---|
| Data | Supabase Postgres (`snake_case` tables: `profiles`, `flows`, `flow_runs`, `flow_run_logs`) | Prisma + SQLite (`db/custom.db`) |
| Auth | Supabase Auth (JWT via `@supabase/ssr` cookies) | Signed httpOnly cookie sessions (HMAC) |
| Access control | RLS policies on every table; **service-role key used only server-side** for webhooks, cron, and maintenance | Server-side userId scoping |
| Scheduler | External pinger (cron-job.org) or Vercel Cron (Pro) → `/api/cron/tick` every minute | Built-in in-process scheduler |

The mode is selected automatically: if `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are all set, the app runs in cloud mode; otherwise it falls back to local demo mode. See `src/lib/env.ts`.

**Engine** — `src/server/engine/` executes a flow as a sequential branch walker: it fires the trigger node, then follows edges node by node, evaluating `{{...}}` template expressions against the run context (no `eval`, pure data lookups). Hard limits keep it serverless-safe: a 50-second run deadline, a 100-node execution cap, log/data truncation before storage, a stale-run sweep that fails runs stuck in `running`, and batched log retention (`RUN_LOG_RETENTION_DAYS`, default 30).

## Deploy to Vercel + Supabase

1. **Create the database.** Create a project on [supabase.com](https://supabase.com), open **SQL Editor → New query**, paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and press **Run**. This creates all tables, RLS policies, triggers, indexes, and RPCs (idempotent — safe to re-run).

2. **Configure auth.** In Supabase go to **Authentication → Providers** and make sure **Email** is enabled. For instant signups, disable **Authentication → Sign In / Up → Confirm email** (or configure SMTP to keep it on). After deploying, set **Authentication → URL Configuration → Site URL** to your Vercel domain.

3. **Deploy the app.** Push this repo to GitHub (`antonydno43/wireitt`) and import it into Vercel (or use `vercel` CLI). Framework preset: Next.js — no build settings needed.

4. **Set environment variables** in **Vercel → Project → Settings → Environment Variables**:

   | Variable | Required | Value |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase → Settings → API → anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase → Settings → API → service_role key (server-only secret) |
   | `CRON_SECRET` | Yes | any long random string (used by `/api/cron/tick`) |
   | `NEXT_PUBLIC_APP_URL` | Optional | e.g. `https://wireitt.vercel.app` (canonical webhook URLs) |
   | `RUN_LOG_RETENTION_DAYS` | Optional | default `30` — auto-cleanup of run logs |
   | `ENGINE_ALLOW_PRIVATE_HTTP` | Optional | `true` to allow HTTP nodes to call private/internal IPs (blocked in production by default) |
   | `APP_SECRET` | Local mode only | session-signing secret when running WITHOUT Supabase |
   | `DATABASE_URL` | Local mode only | `file:./db/custom.db` |

5. **Redeploy** (if you added env vars after the first deploy), open the app, and create an account.

## Scheduled flows

The entire scheduler is a single endpoint: `GET /api/cron/tick`. Each tick runs all due scheduled flows (minute or daily granularity), sweeps stale runs, and enforces run-log retention. It is protected by `CRON_SECRET` and accepts either `Authorization: Bearer <secret>` (how Vercel Cron calls it) or `?secret=<secret>` (handy for external pingers and quick browser tests).

### On the Vercel Hobby plan (recommended setup)

Vercel **Hobby** limits built-in cron jobs to once per day, so minute-level scheduling is done with a free external pinger — [cron-job.org](https://cron-job.org):

1. Set `CRON_SECRET` (any long random string) in **Vercel → Settings → Environment Variables**, then **redeploy**.
2. Sign up at [cron-job.org](https://console.cron-job.org) and open **Jobs → Create job**.
3. Configure the job:
   - **Title** — `WireItt scheduler tick`
   - **URL** — `https://YOUR_DOMAIN.vercel.app/api/cron/tick`
   - **Schedule** — *Custom* → every minute (`* * * * *`)
   - **Advanced → Enable custom headers** — add header `Authorization` = `Bearer YOUR_CRON_SECRET`
     (alternative: just append `?secret=YOUR_CRON_SECRET` to the URL and skip the header)
   - **Notifications** — enable email alerts on failures
4. **Create job**. Within a minute, the job history should show `HTTP 200` responses — that's your scheduler running.

> Occasional *timeout* entries in the cron-job.org history are harmless: the free pinger cuts off after ~30s while Vercel keeps executing the tick up to its 60s limit. The work still completes server-side.

### On the Vercel Pro plan

Re-add the built-in cron to [`vercel.json`](vercel.json) and Vercel calls the endpoint automatically with the correct `Authorization` header:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }
```

Remove the cron-job.org job afterwards to avoid double ticking (harmless, but wasteful).

## Run locally

```bash
bun install        # or: npm install
bun run db:push    # create the local SQLite schema
bun run dev        # http://localhost:3000
```

This starts in **local demo mode** — Prisma + SQLite with built-in scheduler and signed cookie sessions. No Supabase or other services needed. Set `DATABASE_URL=file:./db/custom.db` (default) and a strong `APP_SECRET` if you change anything.

## Security

- **RLS on all tables** — every policy checks `auth.uid()`; users can only select/insert/update/delete their own rows. Runs and logs have no client-side update/delete policies at all.
- **Service-role key never reaches the browser** — it is a server-only env var used exclusively in API routes (webhook execution, cron tick, maintenance).
- **Signed httpOnly cookie sessions** in local mode (HMAC, expiry-checked).
- **Rate limits** — per-IP limits on auth endpoints, per-user run limits, per-token webhook limits.
- **SSRF protection** — HTTP action nodes cannot target loopback/private IPs in production (opt-in via `ENGINE_ALLOW_PRIVATE_HTTP`).
- **Webhook tokens are 160-bit random** (40-char hex), unique per flow, auto-issued when a webhook trigger is added.
- **Input validation with Zod everywhere** — every API route validates its payload before touching the store.

## Scale notes

- Run history uses **keyset pagination** (cursor on `started_at`), not OFFSET.
- **Composite indexes** on `(user_id, started_at desc)`, `(flow_id, started_at desc)`, `(user_id, updated_at desc)` match the dashboard and history queries.
- **Denormalized run counters** (`run_count`, `last_run_at`, `last_run_status`) bumped atomically via the `bump_flow_run` RPC — no COUNT(*) on dashboards.
- **Batched log retention** (`cleanup_old_logs` deletes in capped batches to avoid long locks).
- `flow_run_logs` uses a **bigint identity PK** — no UUID collision concern or index bloat at billions of rows.
- For extreme volumes, consider **partitioning `flow_runs` / `flow_run_logs` by month** with [pg_partman](https://github.com/pgpartman/pg_partman).

## Project structure

```
├── prisma/                  # local demo schema (SQLite)
├── supabase/
│   └── migrations/
│       └── 0001_init.sql    # production Postgres schema + RLS + RPCs
├── src/
│   ├── app/                 # Next.js App Router pages + API routes
│   │   └── api/             # /flows, /runs, /hooks/[token], /auth, /stats, /cron/tick
│   ├── components/
│   │   ├── app/             # dashboard & flow UI
│   │   ├── editor/          # canvas editor, node palette, node config
│   │   └── ui/              # shadcn/ui primitives
│   ├── server/
│   │   ├── auth/            # supabase + local session providers
│   │   ├── store/           # data access (Supabase store / local Prisma store)
│   │   └── engine/          # execution engine, nodes, templating, scheduler
│   └── lib/                 # env config, api client, utils
└── vercel.json              # cron schedule (every minute)
```

## License

MIT © WireItt
