-- MIQYAS subscriptions v1
-- Safe additive migration: does not modify branches, assessments or customer feedback.
-- Run this file in Supabase SQL Editor for the MIQYAS project.

create extension if not exists pgcrypto;

create table if not exists public.subscription_plans (
  code text primary key check (code in ('basic','professional','enterprise')),
  name text not null,
  price_sar numeric(10,2) not null check (price_sar >= 0),
  billing_period_months integer not null default 1 check (billing_period_months > 0),
  branch_limit integer,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.subscription_plans(code,name,price_sar,billing_period_months,branch_limit,features)
values
 ('basic','الأساسية',199,1,5,'["حتى 5 فروع","مؤشرات الجودة وصوت العميل","تقارير Excel"]'::jsonb),
 ('professional','الاحترافية',399,1,20,'["حتى 20 فرعاً","جميع التقارير والتحليلات","مقارنة أداء الفروع"]'::jsonb),
 ('enterprise','المؤسسات',0,1,null,'["عدد فروع مخصص","صلاحيات متعددة","تقارير إدارية متقدمة"]'::jsonb)
on conflict(code) do update set
 name=excluded.name,price_sar=excluded.price_sar,billing_period_months=excluded.billing_period_months,
 branch_limit=excluded.branch_limit,features=excluded.features;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path=public
as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid());
$$;

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code),
  status text not null default 'active' check(status in ('trial','active','past_due','expired','cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  payment_method text check(payment_method in ('bank_transfer','online','manual')),
  created_at timestamptz not null default now()
);
create index if not exists organization_subscriptions_org_created_idx
 on public.organization_subscriptions(organization_id,created_at desc);

create table if not exists public.subscription_payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  plan_code text not null references public.subscription_plans(code),
  amount_sar numeric(10,2) not null check(amount_sar >= 0),
  payment_method text not null check(payment_method in ('bank_transfer','online')),
  status text not null default 'pending' check(status in ('pending','awaiting_gateway','approved','rejected','cancelled')),
  transfer_reference text,
  gateway_checkout_id text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists subscription_payment_requests_org_created_idx
 on public.subscription_payment_requests(organization_id,created_at desc);
create index if not exists subscription_payment_requests_pending_idx
 on public.subscription_payment_requests(status,created_at) where status='pending';

create table if not exists public.subscription_bank_settings (
  id boolean primary key default true check(id=true),
  bank_name text,
  beneficiary_name text,
  iban text,
  instructions text,
  updated_at timestamptz not null default now()
);
insert into public.subscription_bank_settings(id,bank_name,beneficiary_name,iban,instructions)
values(true,null,null,null,'ستضاف بيانات التحويل البنكي الرسمية بعد اعتمادها من إدارة المنصة.')
on conflict(id) do nothing;

alter table public.subscription_plans enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.subscription_payment_requests enable row level security;
alter table public.subscription_bank_settings enable row level security;

drop policy if exists "authenticated read subscription plans" on public.subscription_plans;
create policy "authenticated read subscription plans"
on public.subscription_plans for select to authenticated using(is_active=true or public.is_platform_admin());

drop policy if exists "platform admins manage subscription plans" on public.subscription_plans;
create policy "platform admins manage subscription plans"
on public.subscription_plans for all to authenticated
using(public.is_platform_admin()) with check(public.is_platform_admin());

drop policy if exists "platform admins read platform admins" on public.platform_admins;
create policy "platform admins read platform admins"
on public.platform_admins for select to authenticated using(user_id=auth.uid() or public.is_platform_admin());

drop policy if exists "organization members read subscriptions" on public.organization_subscriptions;
create policy "organization members read subscriptions"
on public.organization_subscriptions for select to authenticated
using(public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists "organization members read payment requests" on public.subscription_payment_requests;
create policy "organization members read payment requests"
on public.subscription_payment_requests for select to authenticated
using(public.is_org_member(organization_id) or public.is_platform_admin());

drop policy if exists "platform admins manage payment requests" on public.subscription_payment_requests;
create policy "platform admins manage payment requests"
on public.subscription_payment_requests for update to authenticated
using(public.is_platform_admin()) with check(public.is_platform_admin());

drop policy if exists "organization members read bank settings" on public.subscription_bank_settings;
create policy "organization members read bank settings"
on public.subscription_bank_settings for select to authenticated using(true);

create or replace function public.create_subscription_payment_request(
  p_organization_id uuid,
  p_plan_code text,
  p_payment_method text,
  p_transfer_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً'; end if;
  if not public.is_org_member(p_organization_id) then raise exception 'ليس لديك صلاحية على هذه المنشأة'; end if;
  if p_payment_method not in ('bank_transfer','online') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_payment_method='bank_transfer' and nullif(trim(p_transfer_reference),'') is null then
    raise exception 'أدخل مرجع التحويل البنكي';
  end if;

  select * into v_plan from public.subscription_plans where code=p_plan_code and is_active=true;
  if not found then raise exception 'الباقة غير متاحة حالياً'; end if;

  insert into public.subscription_payment_requests(
    organization_id,user_id,plan_code,amount_sar,payment_method,status,transfer_reference
  ) values (
    p_organization_id,auth.uid(),v_plan.code,v_plan.price_sar,p_payment_method,
    case when p_payment_method='online' then 'awaiting_gateway' else 'pending' end,
    nullif(trim(p_transfer_reference),'')
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.approve_subscription_payment_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.subscription_payment_requests%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_subscription_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'غير مصرح لك باعتماد الاشتراك'; end if;
  select * into v_request from public.subscription_payment_requests where id=p_request_id for update;
  if not found then raise exception 'طلب الاشتراك غير موجود'; end if;
  if v_request.status <> 'pending' then raise exception 'الطلب ليس بانتظار المراجعة'; end if;
  select * into v_plan from public.subscription_plans where code=v_request.plan_code;

  update public.organization_subscriptions
  set status='expired'
  where organization_id=v_request.organization_id and status='active';

  insert into public.organization_subscriptions(
    organization_id,plan_code,status,starts_at,ends_at,payment_method
  ) values (
    v_request.organization_id,v_request.plan_code,'active',now(),
    now() + make_interval(months=>v_plan.billing_period_months),v_request.payment_method
  ) returning id into v_subscription_id;

  update public.subscription_payment_requests
  set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
  where id=p_request_id;
  return v_subscription_id;
end;
$$;

create or replace function public.reject_subscription_payment_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_platform_admin() then raise exception 'غير مصرح لك برفض طلب الاشتراك'; end if;
  update public.subscription_payment_requests
  set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
  where id=p_request_id and status='pending';
  if not found then raise exception 'الطلب غير موجود أو تمت مراجعته مسبقاً'; end if;
end;
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;
revoke all on function public.create_subscription_payment_request(uuid,text,text,text) from public;
grant execute on function public.create_subscription_payment_request(uuid,text,text,text) to authenticated;
revoke all on function public.approve_subscription_payment_request(uuid) from public;
grant execute on function public.approve_subscription_payment_request(uuid) to authenticated;
revoke all on function public.reject_subscription_payment_request(uuid) from public;
grant execute on function public.reject_subscription_payment_request(uuid) to authenticated;

-- بعد تشغيل الملف، أضف حساب مالك منصة مقياس إلى قائمة مديري المنصة:
-- 1) انسخ User UID الخاص بحسابك من Supabase > Authentication > Users.
-- 2) استبدل UUID أدناه بمعرّف حسابك ثم نفّذ السطر:
-- insert into public.platform_admins(user_id) values ('PASTE-YOUR-AUTH-USER-UUID');

-- إعداد بيانات التحويل البنكي بعد اعتماد الحساب البنكي:
-- update public.subscription_bank_settings
-- set bank_name='اسم البنك', beneficiary_name='اسم المستفيد',
--     iban='SA0000000000000000000000', instructions='يرجى كتابة رقم المنشأة في وصف التحويل',
--     updated_at=now()
-- where id=true;

-- بوابة الدفع الإلكتروني: الواجهة مهيأة لاختيارها لاحقاً، لكن لا تفعّل دفعاً حقيقياً
-- حتى يتم اختيار مزود الدفع وإعداد مفاتيحه السرية في Supabase Edge Functions.
