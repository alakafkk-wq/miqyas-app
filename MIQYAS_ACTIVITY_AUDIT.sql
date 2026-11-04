-- MIQYAS Activity Audit Log
-- Run this script in Supabase SQL Editor using the project owner account.

create table if not exists public.platform_activity_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid null,
  actor_email text null,
  organization_id uuid null,
  organization_name text null,
  action text not null check (action in ('INSERT','UPDATE','DELETE','LOGIN')),
  table_name text not null,
  record_id text null,
  details jsonb null
);

create index if not exists platform_activity_audit_created_at_idx
  on public.platform_activity_audit (created_at desc);
create index if not exists platform_activity_audit_org_idx
  on public.platform_activity_audit (organization_id, created_at desc);

alter table public.platform_activity_audit enable row level security;
drop policy if exists "platform admins read activity audit" on public.platform_activity_audit;
create policy "platform admins read activity audit"
  on public.platform_activity_audit for select to authenticated
  using (public.is_platform_admin());

create or replace function public.log_platform_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  org_id uuid;
  org_name text;
  rec_id text;
  action_name text;
  actor uuid;
  actor_mail text;
begin
  if tg_op = 'INSERT' then
    new_row := to_jsonb(NEW);
    row_data := new_row;
    action_name := 'INSERT';
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    row_data := new_row;
    action_name := 'UPDATE';
  else
    old_row := to_jsonb(OLD);
    row_data := old_row;
    action_name := 'DELETE';
  end if;

  rec_id := coalesce(row_data->>'id', row_data->>'uuid');
  begin
    org_id := nullif(coalesce(row_data->>'organization_id', row_data->>'id'), '')::uuid;
  exception when others then org_id := null;
  end;

  if tg_table_name = 'organizations' then
    org_name := coalesce(row_data->>'name', '');
  elsif org_id is not null then
    select o.name into org_name from public.organizations o where o.id = org_id;
  end if;

  actor := auth.uid();
  actor_mail := auth.jwt()->>'email';

  insert into public.platform_activity_audit
    (actor_id, actor_email, organization_id, organization_name, action, table_name, record_id, details)
  values
    (actor, actor_mail, org_id, org_name, action_name, tg_table_name, rec_id,
     jsonb_build_object(
       'old', case when old_row is null then null else old_row - 'password' - 'access_token' - 'refresh_token' - 'secret' - 'api_key' end,
       'new', case when new_row is null then null else new_row - 'password' - 'access_token' - 'refresh_token' - 'secret' - 'api_key' end
     ));

  if tg_op = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

-- Attach audit triggers to the core business tables. Re-running is safe.
do $$
declare t text;
begin
  foreach t in array array['organizations','branches','quality_assessments','customer_feedback','ecommerce_stores','organization_subscriptions','subscription_payment_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit_%I on public.%I', t, t);
      execute format('create trigger trg_audit_%I after insert or update or delete on public.%I for each row execute function public.log_platform_activity()', t, t);
    end if;
  end loop;
end $$;

revoke all on public.platform_activity_audit from anon;
grant select on public.platform_activity_audit to authenticated;


create or replace function public.log_platform_login()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.platform_activity_audit
    (actor_id, actor_email, action, table_name, details)
  values
    (auth.uid(), auth.jwt()->>'email', 'LOGIN', 'auth', jsonb_build_object('event','successful_sign_in'));
end;
$$;
revoke all on function public.log_platform_login() from public;
grant execute on function public.log_platform_login() to authenticated;
