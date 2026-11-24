-- MIQYAS + Geidea: additive, idempotent migration
-- Run once in Supabase SQL Editor after taking a database backup.
-- Does not delete payment requests or existing subscriptions.

begin;

alter table public.subscription_payment_requests
  add column if not exists gateway_order_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists gateway_status text;

-- Replace only the known status constraint; preserve all other constraints.
alter table public.subscription_payment_requests
  drop constraint if exists subscription_payment_requests_status_check;
alter table public.subscription_payment_requests
  add constraint subscription_payment_requests_status_check
  check (status = any (array[
    'pending'::text, 'awaiting_gateway'::text, 'paid'::text,
    'approved'::text, 'rejected'::text, 'cancelled'::text, 'failed'::text
  ]));

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique references public.subscription_payment_requests(id),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  invoice_number text not null unique,
  plan_code text not null references public.subscription_plans(code),
  amount_sar numeric(10,2) not null check (amount_sar >= 0),
  currency text not null default 'SAR' check (currency = 'SAR'),
  payment_method text not null default 'online',
  gateway_order_id text not null,
  status text not null default 'paid' check (status in ('paid','void')),
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists subscription_invoices_org_issued_idx
  on public.subscription_invoices (organization_id, issued_at desc);
create unique index if not exists subscription_payment_requests_gateway_order_uidx
  on public.subscription_payment_requests (gateway_order_id)
  where gateway_order_id is not null;

alter table public.subscription_invoices enable row level security;
drop policy if exists "organization members read subscription invoices" on public.subscription_invoices;
create policy "organization members read subscription invoices"
  on public.subscription_invoices for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create or replace function public.finalize_geidea_subscription_payment(
  p_request_id uuid, p_gateway_order_id text, p_amount_sar numeric, p_currency text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.subscription_payment_requests%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_invoice_id uuid;
  v_period integer;
  v_existing_subscription_id uuid;
begin
  if p_currency is distinct from 'SAR' then raise exception 'Unsupported payment currency'; end if;
  if nullif(trim(p_gateway_order_id), '') is null then raise exception 'Missing Geidea order id'; end if;

  select * into v_req from public.subscription_payment_requests where id = p_request_id for update;
  if not found then raise exception 'Payment request not found'; end if;
  if round(v_req.amount_sar, 2) <> round(p_amount_sar, 2) then raise exception 'Payment amount mismatch'; end if;
  if v_req.payment_method <> 'online' then raise exception 'Payment method mismatch'; end if;

  select id into v_invoice_id from public.subscription_invoices where payment_request_id = v_req.id;
  if v_req.status = 'paid' and v_invoice_id is not null then return v_invoice_id; end if;
  if v_req.status <> 'awaiting_gateway' then raise exception 'Payment request is not awaiting gateway confirmation'; end if;

  select * into v_plan from public.subscription_plans where code = v_req.plan_code and is_active = true;
  if not found then raise exception 'Subscription plan unavailable'; end if;
  v_period := greatest(coalesce(v_plan.billing_period_months, 1), 1);

  -- Update the current active/trial subscription in place so the app continues
  -- reading the same latest subscription row after an early renewal.
  select id into v_existing_subscription_id
  from public.organization_subscriptions
  where organization_id = v_req.organization_id
    and status in ('active', 'trial')
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  order by created_at desc limit 1 for update;

  if v_existing_subscription_id is not null then
    update public.organization_subscriptions
    set plan_code = v_req.plan_code, status = 'active', payment_method = 'online',
        ends_at = greatest(coalesce(ends_at, now()), now()) + make_interval(months => v_period)
    where id = v_existing_subscription_id;
  else
    insert into public.organization_subscriptions
      (organization_id, plan_code, status, starts_at, ends_at, payment_method)
    values (v_req.organization_id, v_req.plan_code, 'active', now(),
            now() + make_interval(months => v_period), 'online');
  end if;

  update public.subscription_payment_requests
  set status = 'paid', gateway_order_id = p_gateway_order_id,
      paid_at = now(), gateway_status = 'SUCCESS'
  where id = v_req.id;

  insert into public.subscription_invoices
    (payment_request_id, organization_id, user_id, invoice_number, plan_code,
     amount_sar, currency, payment_method, gateway_order_id, status, issued_at, paid_at)
  values
    (v_req.id, v_req.organization_id, v_req.user_id,
     'MIQ-' || to_char(now(), 'YYYYMM') || '-' ||
       upper(substr(replace(v_req.id::text, '-', ''), 1, 8)),
     v_req.plan_code, v_req.amount_sar, 'SAR', 'online',
     p_gateway_order_id, 'paid', now(), now())
  returning id into v_invoice_id;

  return v_invoice_id;
end;
$$;

revoke all on function public.finalize_geidea_subscription_payment(uuid, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.finalize_geidea_subscription_payment(uuid, text, numeric, text)
  to service_role;

commit;
