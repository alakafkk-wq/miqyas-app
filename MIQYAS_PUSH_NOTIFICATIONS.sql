-- MIQYAS Web Push subscriptions (additive migration)
-- Run in Supabase SQL Editor. Does not alter subscription/payment tables.
create table if not exists public.miqyas_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.miqyas_push_subscriptions enable row level security;

drop policy if exists "platform admins manage own push subscriptions" on public.miqyas_push_subscriptions;
create policy "platform admins manage own push subscriptions"
on public.miqyas_push_subscriptions for all to authenticated
using (user_id=auth.uid() and public.is_platform_admin())
with check (user_id=auth.uid() and public.is_platform_admin());

create index if not exists miqyas_push_subscriptions_user_idx
  on public.miqyas_push_subscriptions(user_id);

select relrowsecurity from pg_class where oid='public.miqyas_push_subscriptions'::regclass;
