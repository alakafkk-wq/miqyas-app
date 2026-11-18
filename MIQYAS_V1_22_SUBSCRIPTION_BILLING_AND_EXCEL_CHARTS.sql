-- MIQYAS v1.22.0: monthly + annual subscriptions (20% annual discount)
-- Safe additive migration. Existing monthly plans, subscriptions and payment records are preserved.
-- Run once in Supabase SQL Editor after taking a database backup.
begin;

-- Older installations may still have a CHECK constraint limiting plan codes to the original three.
-- Annual and ecommerce plan codes already require an expanded code domain.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.subscription_plans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%code%'
  loop
    execute format('alter table public.subscription_plans drop constraint %I', c.conname);
  end loop;
end $$;

-- Ensure the duration and business-type fields used by the current MIQYAS release exist.
alter table public.subscription_plans
  add column if not exists billing_period_months integer not null default 1;
alter table public.subscription_plans
  add column if not exists business_type text not null default 'branches';
alter table public.subscription_plans
  add column if not exists max_users integer;

-- Reassert the approved monthly branch prices and limits without touching existing subscriptions.
update public.subscription_plans
set business_type='branches',
    price_sar=case code when 'basic' then 99 when 'professional' then 199 when 'enterprise' then 399 else price_sar end,
    billing_period_months=1,
    branch_limit=case code when 'basic' then 1 when 'professional' then 5 when 'enterprise' then 20 else branch_limit end,
    max_users=case code when 'basic' then 3 when 'professional' then 10 when 'enterprise' then 30 else max_users end,
    is_active=true
where code in ('basic','professional','enterprise');

-- Ensure the monthly ecommerce plans exist before creating their annual variants.
insert into public.subscription_plans
  (code,name,price_sar,billing_period_months,branch_limit,max_users,features,is_active,business_type)
values
 ('ecom_basic','الأساسية للمتاجر',99,1,1,3,'["متجر واحد","حتى 3 مستخدمين","تقارير تجربة العميل"]'::jsonb,true,'ecommerce'),
 ('ecom_professional','الاحترافية للمتاجر',199,1,5,10,'["حتى 5 متاجر","حتى 10 مستخدمين","تقارير ومقارنات المتاجر"]'::jsonb,true,'ecommerce'),
 ('ecom_enterprise','المؤسسات للمتاجر',399,1,20,30,'["حتى 20 متجراً","حتى 30 مستخدماً","تقارير إدارية متقدمة"]'::jsonb,true,'ecommerce')
on conflict (code) do update set
 name=excluded.name, price_sar=excluded.price_sar, billing_period_months=1,
 branch_limit=excluded.branch_limit, max_users=excluded.max_users,
 features=excluded.features, is_active=true, business_type='ecommerce';

-- Create annual variants for all six monthly plans (branches + ecommerce).
-- Annual price = monthly price x 12 x 80% (20% discount).
insert into public.subscription_plans
  (code, name, price_sar, billing_period_months, branch_limit, max_users, features, is_active, business_type)
select
  p.code || '_annual',
  p.name || ' – سنوي',
  round(p.price_sar * 12 * 0.80, 2),
  12,
  p.branch_limit,
  p.max_users,
  p.features,
  p.is_active,
  p.business_type
from public.subscription_plans p
where p.code in ('basic','professional','enterprise','ecom_basic','ecom_professional','ecom_enterprise')
  and p.billing_period_months = 1
on conflict (code) do update set
  name = excluded.name,
  price_sar = excluded.price_sar,
  billing_period_months = 12,
  branch_limit = excluded.branch_limit,
  max_users = excluded.max_users,
  features = excluded.features,
  is_active = excluded.is_active,
  business_type = excluded.business_type;

-- Validate expected annual prices before committing.
do $$
begin
  if not exists (select 1 from public.subscription_plans where code='basic_annual' and price_sar=950.40 and billing_period_months=12) then
    raise exception 'تعذر التحقق من سعر الباقة الأساسية السنوية';
  end if;
  if not exists (select 1 from public.subscription_plans where code='professional_annual' and price_sar=1910.40 and billing_period_months=12) then
    raise exception 'تعذر التحقق من سعر الباقة الاحترافية السنوية';
  end if;
  if not exists (select 1 from public.subscription_plans where code='enterprise_annual' and price_sar=3830.40 and billing_period_months=12) then
    raise exception 'تعذر التحقق من سعر باقة المؤسسات السنوية';
  end if;
end $$;

commit;

select code, name, price_sar, billing_period_months, business_type, branch_limit, max_users, is_active
from public.subscription_plans
where code in (
 'basic','professional','enterprise','ecom_basic','ecom_professional','ecom_enterprise',
 'basic_annual','professional_annual','enterprise_annual',
 'ecom_basic_annual','ecom_professional_annual','ecom_enterprise_annual'
)
order by business_type, billing_period_months, price_sar;
