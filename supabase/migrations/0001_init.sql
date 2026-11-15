-- ============================================================================
-- WireItt — initial production migration for Supabase (PostgreSQL 15)
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- It is idempotent: every statement uses IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS, so re-running it never errors.
--
-- What this migration creates:
--
--   Tables (all in the `public` schema, all with Row Level Security):
--     profiles       — one row per account, mirroring auth.users
--                      (auto-created on signup by a trigger)
--     flows          — user-owned automations: graph JSONB, webhook token,
--                      schedule config, denormalized run counters
--     flow_runs      — one row per execution; written by the trusted server
--                      (service role), read by the owner
--     flow_run_logs  — high-volume per-node execution logs
--                      (bigint identity PK to survive billions of rows)
--
--   Triggers:
--     on_auth_user_created  — mirrors new auth.users rows into profiles
--     flows_set_updated_at  — updated_at maintenance on flows
--
--   Indexes: composite + partial indexes for the dashboard, run-history
--   (keyset pagination), webhook lookup and the scheduler tick query.
--
--   RPCs (server-side only, invoked with the service-role key which
--   bypasses RLS — execute is revoked from anon/authenticated):
--     bump_flow_run(p_flow_id, p_status) — atomic run-counter bump
--     cleanup_old_logs(p_days, p_batch)  — batched log-retention delete
--
-- Column names and RPC signatures must stay in sync with
-- src/server/store/supabase-store.ts (snake_case columns).
-- ============================================================================

begin;

-- gen_random_uuid() for flow / run primary keys
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- PROFILES — mirrors auth.users
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- no delete policy: profiles live and die with auth.users (on delete cascade)

-- Auto-create a profile row whenever a user signs up.
-- security definer so the insert runs with elevated rights (auth triggers
-- do not carry the user's JWT), with a pinned search_path for safety.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- FLOWS — the user-owned automations
-- ----------------------------------------------------------------------------
create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled flow',
  description text,
  status text not null default 'paused' check (status in ('active','paused')),
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  trigger_type text,                                      -- trigger.manual | trigger.webhook | trigger.schedule
  webhook_token text unique,                              -- 160-bit hex token -> public webhook URL
  schedule_type text check (schedule_type in ('minutes','daily')),
  schedule_interval int,
  schedule_time text,
  next_run_at timestamptz,
  run_count bigint not null default 0,
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.flows enable row level security;

drop policy if exists "flows_select_own" on public.flows;
create policy "flows_select_own"
  on public.flows for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "flows_insert_own" on public.flows;
create policy "flows_insert_own"
  on public.flows for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "flows_update_own" on public.flows;
create policy "flows_update_own"
  on public.flows for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "flows_delete_own" on public.flows;
create policy "flows_delete_own"
  on public.flows for delete to authenticated
  using (auth.uid() = user_id);

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists flows_set_updated_at on public.flows;
create trigger flows_set_updated_at
  before update on public.flows
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- FLOW RUNS — one row per execution (written by the trusted server only)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','success','error')),
  trigger_type text not null check (trigger_type in ('manual','webhook','schedule','test')),
  input jsonb,
  output jsonb,
  error text,
  steps jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms int
);

alter table public.flow_runs enable row level security;

drop policy if exists "flow_runs_select_own" on public.flow_runs;
create policy "flow_runs_select_own"
  on public.flow_runs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "flow_runs_insert_own" on public.flow_runs;
create policy "flow_runs_insert_own"
  on public.flow_runs for insert to authenticated
  with check (auth.uid() = user_id);

-- no update/delete policies: runs are finalized by the service-role backend

-- ----------------------------------------------------------------------------
-- FLOW RUN LOGS — high volume (bigint identity PK, denormalized flow_id /
-- user_id kept WITHOUT foreign keys for insert throughput; cascade cleanup
-- happens via run_id -> flow_runs -> flows)
-- ----------------------------------------------------------------------------
create table if not exists public.flow_run_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.flow_runs(id) on delete cascade,
  flow_id uuid not null,
  user_id uuid not null,
  node_id text not null,
  node_type text not null,
  level text not null default 'info' check (level in ('info','success','error')),
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

alter table public.flow_run_logs enable row level security;

drop policy if exists "flow_run_logs_select_own" on public.flow_run_logs;
create policy "flow_run_logs_select_own"
  on public.flow_run_logs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "flow_run_logs_insert_own" on public.flow_run_logs;
create policy "flow_run_logs_insert_own"
  on public.flow_run_logs for insert to authenticated
  with check (auth.uid() = user_id);

-- no update/delete policies: logs are append-only from the client's perspective

-- ----------------------------------------------------------------------------
-- INDEXES for scale (millions of flows / runs / logs)
-- ----------------------------------------------------------------------------
create index if not exists flows_user_updated_idx
  on public.flows (user_id, updated_at desc);

create index if not exists flows_webhook_token_idx
  on public.flows (webhook_token) where webhook_token is not null;

-- scheduler tick: only active scheduled flows that are due
create index if not exists flows_next_run_idx
  on public.flows (next_run_at) where next_run_at is not null and status = 'active';

create index if not exists flow_runs_user_started_idx
  on public.flow_runs (user_id, started_at desc);

create index if not exists flow_runs_flow_started_idx
  on public.flow_runs (flow_id, started_at desc);

create index if not exists flow_run_logs_run_idx
  on public.flow_run_logs (run_id);

create index if not exists flow_run_logs_user_created_idx
  on public.flow_run_logs (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- TABLE GRANTS — Supabase's default privileges normally cover these; they are
-- restated explicitly so the migration is deterministic on any project.
-- RLS still restricts row access; these are table-level privileges only.
-- ----------------------------------------------------------------------------
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.flows to authenticated;
grant select, insert on public.flow_runs to authenticated;
grant select, insert on public.flow_run_logs to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.flows to service_role;
grant select, insert, update, delete on public.flow_runs to service_role;
grant select, insert, update, delete on public.flow_run_logs to service_role;

-- ----------------------------------------------------------------------------
-- RPCs used by the trusted server only (service role bypasses RLS).
-- EXECUTE is revoked from anon/authenticated so they cannot be called from
-- the browser or via the public PostgREST endpoint.
-- ----------------------------------------------------------------------------

-- Atomic counter bump: run_count + last_run_at/last_run_status in one UPDATE.
create or replace function public.bump_flow_run(p_flow_id uuid, p_status text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.flows
  set run_count = run_count + 1, last_run_at = now(), last_run_status = p_status
  where id = p_flow_id;
$$;

revoke execute on function public.bump_flow_run(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_flow_run(uuid, text) to service_role;

-- Batched retention cleanup: deletes up to p_batch log rows older than
-- p_days and returns the number of rows removed (call in a loop until 0).
create or replace function public.cleanup_old_logs(p_days int, p_batch int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int;
begin
  with old as (
    select id from public.flow_run_logs
    where created_at < now() - (p_days || ' days')::interval
    limit p_batch
  )
  delete from public.flow_run_logs l using old where l.id = old.id;
  get diagnostics deleted = row_count;
  return deleted;
end; $$;

revoke execute on function public.cleanup_old_logs(int, int) from public, anon, authenticated;
grant execute on function public.cleanup_old_logs(int, int) to service_role;

commit;
