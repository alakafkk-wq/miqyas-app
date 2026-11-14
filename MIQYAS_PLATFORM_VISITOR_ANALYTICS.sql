-- MIQYAS v1.21.6: Platform visitor analytics
-- Tracks authenticated workspace visits only.
-- Excludes marketing-site pageviews, public QR feedback pages, and platform-admin sessions.
-- Stores only random browser/session UUIDs; no name, email, phone, auth UID, or IP address.

create table if not exists public.platform_visitor_events (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null,
  session_id uuid not null unique,
  business_type text not null check (business_type in ('branches','ecommerce')),
  visited_at timestamptz not null default now()
);

create index if not exists platform_visitor_events_visited_at_idx
  on public.platform_visitor_events (visited_at desc);
create index if not exists platform_visitor_events_visitor_visited_idx
  on public.platform_visitor_events (visitor_id, visited_at desc);

alter table public.platform_visitor_events enable row level security;

-- No direct table access for anon/authenticated. Access is through guarded RPCs.
revoke all on table public.platform_visitor_events from anon, authenticated;

create or replace function public.miqyas_record_platform_visit(
  p_visitor_id uuid,
  p_session_id uuid,
  p_business_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'تسجيل الزيارة يتطلب تسجيل الدخول';
  end if;

  if coalesce(public.is_platform_admin(), false) then
    return false;
  end if;

  if p_visitor_id is null or p_session_id is null then
    raise exception 'معرف الزيارة غير صالح';
  end if;

  if p_business_type not in ('branches','ecommerce') then
    raise exception 'نوع النشاط غير صالح';
  end if;

  insert into public.platform_visitor_events(visitor_id, session_id, business_type)
  values (p_visitor_id, p_session_id, p_business_type)
  on conflict (session_id) do nothing;

  return true;
end;
$$;

create or replace function public.miqyas_admin_platform_visitor_daily(
  p_start date default null,
  p_end date default null
)
returns table (
  visit_date date,
  visits bigint,
  unique_visitors bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'غير مصرح: هذه الإحصائيات لمدير المنصة فقط';
  end if;

  return query
  select
    (e.visited_at at time zone 'Asia/Riyadh')::date as visit_date,
    count(*)::bigint as visits,
    count(distinct e.visitor_id)::bigint as unique_visitors
  from public.platform_visitor_events e
  where (p_start is null or (e.visited_at at time zone 'Asia/Riyadh')::date >= p_start)
    and (p_end is null or (e.visited_at at time zone 'Asia/Riyadh')::date <= p_end)
  group by (e.visited_at at time zone 'Asia/Riyadh')::date
  order by visit_date desc;
end;
$$;

create or replace function public.miqyas_admin_platform_visitor_summary(
  p_start date default null,
  p_end date default null
)
returns table (
  total_visits bigint,
  unique_visitors bigint,
  returning_visitors bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_platform_admin(), false) then
    raise exception 'غير مصرح: هذه الإحصائيات لمدير المنصة فقط';
  end if;

  return query
  with period_events as (
    select e.visitor_id, e.session_id, e.visited_at
    from public.platform_visitor_events e
    where (p_start is null or (e.visited_at at time zone 'Asia/Riyadh')::date >= p_start)
      and (p_end is null or (e.visited_at at time zone 'Asia/Riyadh')::date <= p_end)
  ),
  visitor_counts as (
    select
      pe.visitor_id,
      count(*) as period_visits,
      exists (
        select 1
        from public.platform_visitor_events prior
        where prior.visitor_id = pe.visitor_id
          and prior.visited_at < min(pe.visited_at)
      ) as visited_before_period
    from period_events pe
    group by pe.visitor_id
  )
  select
    (select count(*)::bigint from period_events),
    (select count(*)::bigint from visitor_counts),
    (select count(*)::bigint from visitor_counts vc
      where vc.visited_before_period or vc.period_visits > 1);
end;
$$;

revoke all on function public.miqyas_record_platform_visit(uuid,uuid,text) from public, anon;
revoke all on function public.miqyas_admin_platform_visitor_daily(date,date) from public, anon;
revoke all on function public.miqyas_admin_platform_visitor_summary(date,date) from public, anon;

grant execute on function public.miqyas_record_platform_visit(uuid,uuid,text) to authenticated;
grant execute on function public.miqyas_admin_platform_visitor_daily(date,date) to authenticated;
grant execute on function public.miqyas_admin_platform_visitor_summary(date,date) to authenticated;
