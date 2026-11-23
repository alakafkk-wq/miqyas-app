-- MIQYAS Geidea payment finalization (additive migration)
-- Run in Supabase SQL Editor after taking a database backup.
begin;

alter table public.subscription_payment_requests
  add column if not exists gateway_order_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists gateway_status text;

-- Expand the existing status domain without changing existing rows.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid='public.subscription_payment_requests'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.subscription_payment_requests drop constraint %I',c.conname); end loop;
end $$;
alter table public.subscription_payment_requests
  add constraint subscription_payment_requests_status_check
  check(status in ('pending','awaiting_gateway','paid','approved','rejected','cancelled','failed'));

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique references public.subscription_payment_requests(id),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  invoice_number text not null unique,
  plan_code text not null references public.subscription_plans(code),
  amount_sar numeric(10,2) not null,
  currency text not null default 'SAR',
  payment_method text not null default 'online',
  gateway_order_id text not null,
  status text not null default 'paid' check(status in ('paid','void')),
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists subscription_invoices_org_issued_idx
  on public.subscription_invoices(organization_id,issued_at desc);
alter table public.subscription_invoices enable row level security;
drop policy if exists "organization members read subscription invoices" on public.subscription_invoices;
create policy "organization members read subscription invoices"
  on public.subscription_invoices for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create or replace function public.finalize_geidea_subscription_payment(
  p_request_id uuid,
  p_gateway_order_id text,
  p_amount_sar numeric,
  p_currency text
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_req public.subscription_payment_requests%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_invoice_id uuid;
  v_period integer;
begin
  if p_currency <> 'SAR' then raise exception 'Unsupported payment currency'; end if;
  select * into v_req from public.subscription_payment_requests where id=p_request_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if round(v_req.amount_sar,2) <> round(p_amount_sar,2) then raise exception 'Payment amount mismatch'; end if;
  if v_req.payment_method <> 'online' then raise exception 'Payment method mismatch'; end if;

  select id into v_invoice_id from public.subscription_invoices where payment_request_id=v_req.id;
  if v_req.status='paid' and v_invoice_id is not null then return v_invoice_id; end if;
  if v_req.status <> 'awaiting_gateway' then raise exception 'Payment request is not awaiting gateway confirmation'; end if;

  select * into v_plan from public.subscription_plans where code=v_req.plan_code and is_active=true;
  if not found then raise exception 'Subscription plan unavailable'; end if;
  v_period := greatest(coalesce(v_plan.billing_period_months,1),1);

  update public.organization_subscriptions
    set status='expired'
    where organization_id=v_req.organization_id and status='active';
  insert into public.organization_subscriptions(organization_id,plan_code,status,starts_at,ends_at,payment_method)
    values(v_req.organization_id,v_req.plan_code,'active',now(),now()+make_interval(months=>v_period),'online');

  update public.subscription_payment_requests
    set status='paid',gateway_order_id=p_gateway_order_id,paid_at=now(),gateway_status='SUCCESS'
    where id=v_req.id;

  insert into public.subscription_invoices(
    payment_request_id,organization_id,user_id,invoice_number,plan_code,amount_sar,currency,payment_method,gateway_order_id,status
  ) values (
    v_req.id,v_req.organization_id,v_req.user_id,
    'MIQ-'||to_char(now(),'YYYYMM')||'-'||upper(substr(replace(v_req.id::text,'-',''),1,8)),
    v_req.plan_code,v_req.amount_sar,'SAR','online',p_gateway_order_id,'paid'
  ) returning id into v_invoice_id;
  return v_invoice_id;
end;
$$;

revoke all on function public.finalize_geidea_subscription_payment(uuid,text,numeric,text) from public, anon, authenticated;
grant execute on function public.finalize_geidea_subscription_payment(uuid,text,numeric,text) to service_role;
commit;
