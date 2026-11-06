-- MIQYAS unified subscriptions v1.20
-- Run once in Supabase SQL Editor after backing up the project.
begin;

alter table public.organizations add column if not exists business_type text not null default 'branches';

-- Backfill existing organizations from their owner's saved signup metadata where available.
update public.organizations o
set business_type='ecommerce'
where exists (
 select 1 from public.organization_members m
 join auth.users u on u.id=m.user_id
 where m.organization_id=o.id and m.role='owner'
   and u.raw_user_meta_data->>'business_type'='ecommerce'
);

alter table public.subscription_plans
  add column if not exists business_type text not null default 'branches';
alter table public.subscription_plans
  drop constraint if exists subscription_plans_business_type_check;
alter table public.subscription_plans
  add constraint subscription_plans_business_type_check
  check (business_type in ('branches','ecommerce'));

-- Keep existing branch plans and create separate ecommerce plan codes.
update public.subscription_plans
set business_type='branches',
    name=case code when 'basic' then 'الأساسية' when 'professional' then 'الاحترافية' when 'enterprise' then 'المؤسسات' else name end,
    price_sar=case code when 'basic' then 99 when 'professional' then 199 when 'enterprise' then 399 else price_sar end,
    branch_limit=case code when 'basic' then 1 when 'professional' then 5 when 'enterprise' then 20 else branch_limit end,
    max_users=case code when 'basic' then 3 when 'professional' then 10 when 'enterprise' then 30 else max_users end
where code in ('basic','professional','enterprise');

insert into public.subscription_plans(code,name,price_sar,billing_period_months,branch_limit,max_users,features,is_active,business_type)
values
 ('ecom_basic','الأساسية للمتاجر',99,1,1,3,'["متجر واحد","حتى 3 مستخدمين","تقارير تجربة العميل"]'::jsonb,true,'ecommerce'),
 ('ecom_professional','الاحترافية للمتاجر',199,1,5,10,'["حتى 5 متاجر","حتى 10 مستخدمين","تقارير ومقارنات المتاجر"]'::jsonb,true,'ecommerce'),
 ('ecom_enterprise','المؤسسات للمتاجر',399,1,20,30,'["حتى 20 متجراً","حتى 30 مستخدماً","تقارير إدارية متقدمة"]'::jsonb,true,'ecommerce')
on conflict(code) do update set
 name=excluded.name,price_sar=excluded.price_sar,billing_period_months=1,
 branch_limit=excluded.branch_limit,max_users=excluded.max_users,
 features=excluded.features,is_active=true,business_type='ecommerce';

-- Trial and manual-grant audit log. Preserve existing audit rows.
create table if not exists public.platform_subscription_grants (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 subscription_id uuid references public.organization_subscriptions(id) on delete set null,
 grant_type text not null check(grant_type in ('trial','admin_free')),
 plan_code text not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason text,
 actor_id uuid,
 created_at timestamptz not null default now()
);
alter table public.platform_subscription_grants enable row level security;
drop policy if exists "platform admins read subscription grants" on public.platform_subscription_grants;
create policy "platform admins read subscription grants"
on public.platform_subscription_grants for select to authenticated
using (public.is_platform_admin());

-- Every newly created organization gets one five-day trial using the matching business plan.
create or replace function public.create_organization(org_name text, org_industry text default 'other')
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
 v_org uuid;
 v_type text;
 v_plan text;
 v_sub uuid;
 v_start timestamptz := now();
 v_end timestamptz := now() + interval '5 days';
begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if nullif(trim(org_name),'') is null then raise exception 'Organization name is required'; end if;
 v_type := case when (select auth.jwt()->'user_metadata'->>'business_type')='ecommerce' then 'ecommerce' else 'branches' end;
 v_plan := case when v_type='ecommerce' then 'ecom_basic' else 'basic' end;
 insert into public.organizations(name,industry,business_type) values(trim(org_name),coalesce(org_industry,'other'),v_type) returning id into v_org;
 insert into public.organization_members(organization_id,user_id,role) values(v_org,(select auth.uid()),'owner');
 insert into public.organization_subscriptions(organization_id,plan_code,status,starts_at,ends_at,payment_method)
 values(v_org,v_plan,'trial',v_start,v_end,'manual') returning id into v_sub;
 insert into public.platform_subscription_grants(organization_id,subscription_id,grant_type,plan_code,starts_at,ends_at,reason,actor_id)
 values(v_org,v_sub,'trial',v_plan,v_start,v_end,'تجربة مجانية تلقائية لمدة 5 أيام',null);
 return v_org;
end;
$function$;

-- Treat a valid trial as entitled, in addition to paid active subscriptions.
create or replace function public.miqyas_has_active_subscription(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='public'
as $function$
 select exists(
  select 1 from public.organization_subscriptions s
  where s.organization_id=p_organization_id
    and s.status in ('active','trial')
    and s.starts_at<=now()
    and (s.ends_at is null or s.ends_at>now())
 );
$function$;

-- Admin-only manual complimentary subscription grant.
create or replace function public.platform_grant_free_subscription(
 p_organization_id uuid,
 p_plan_code text,
 p_duration_days integer,
 p_reason text default null
) returns uuid
language plpgsql security definer set search_path='public'
as $function$
declare
 v_plan public.subscription_plans%rowtype;
 v_org_type text;
 v_sub uuid;
 v_start timestamptz:=now();
 v_end timestamptz;
begin
 if auth.uid() is null or not public.is_platform_admin() then
  raise exception 'هذه العملية متاحة لمدير المنصة فقط';
 end if;
 if p_duration_days is null or p_duration_days<1 or p_duration_days>365 then
  raise exception 'مدة المنحة يجب أن تكون بين يوم و365 يوماً';
 end if;
 select business_type into v_org_type from public.organizations where id=p_organization_id for update;
 if not found then raise exception 'المنشأة غير موجودة'; end if;
 select * into v_plan from public.subscription_plans
 where code=p_plan_code and is_active and business_type=v_org_type;
 if not found then raise exception 'الباقة لا تتوافق مع نوع نشاط المنشأة'; end if;
 v_end:=v_start+make_interval(days=>p_duration_days);
 update public.organization_subscriptions set status='expired'
 where organization_id=p_organization_id and status in ('active','trial')
   and starts_at<=now() and (ends_at is null or ends_at>now());
 insert into public.organization_subscriptions(organization_id,plan_code,status,starts_at,ends_at,payment_method)
 values(p_organization_id,p_plan_code,'active',v_start,v_end,'manual') returning id into v_sub;
 insert into public.platform_subscription_grants(organization_id,subscription_id,grant_type,plan_code,starts_at,ends_at,reason,actor_id)
 values(p_organization_id,v_sub,'admin_free',p_plan_code,v_start,v_end,nullif(trim(p_reason),''),auth.uid());
 return v_sub;
end;
$function$;
revoke all on function public.platform_grant_free_subscription(uuid,text,integer,text) from public;
grant execute on function public.platform_grant_free_subscription(uuid,text,integer,text) to authenticated;


-- Extend the existing limits trigger to recognize trial subscriptions and ecommerce stores.
create or replace function public.miqyas_enforce_subscription_limits()
returns trigger language plpgsql security definer set search_path='public'
as $function$
declare
 v_plan_code text;
 v_business_type text;
 v_limit integer;
 v_user_limit integer;
 v_count integer;
begin
 if auth.uid() is not null and public.is_platform_admin() then return new; end if;
 select s.plan_code,p.business_type,p.branch_limit,p.max_users
 into v_plan_code,v_business_type,v_limit,v_user_limit
 from public.organization_subscriptions s
 join public.subscription_plans p on p.code=s.plan_code
 where s.organization_id=new.organization_id
   and s.status in ('active','trial')
   and s.starts_at<=now() and (s.ends_at is null or s.ends_at>now())
 order by s.created_at desc limit 1;

 if tg_table_name='branches' then
   if v_plan_code is null or v_business_type<>'branches' then raise exception 'يلزم اشتراك فعال خاص بالفروع'; end if;
   select count(*) into v_count from public.branches where organization_id=new.organization_id;
   if v_limit is not null and v_count>=v_limit then raise exception 'وصلت إلى الحد الأقصى للفروع في باقتك'; end if;
 elsif tg_table_name='ecommerce_stores' then
   if v_plan_code is null or v_business_type<>'ecommerce' then raise exception 'يلزم اشتراك فعال خاص بالمتاجر الإلكترونية'; end if;
   select count(*) into v_count from public.ecommerce_stores where organization_id=new.organization_id;
   if v_limit is not null and v_count>=v_limit then raise exception 'وصلت إلى الحد الأقصى للمتاجر في باقتك'; end if;
 elsif tg_table_name='organization_members' then
   select count(*) into v_count from public.organization_members where organization_id=new.organization_id;
   if v_plan_code is null then
     if v_count>=1 then raise exception 'إضافة مستخدمين إضافيين تتطلب اشتراكاً فعالاً'; end if;
   elsif v_user_limit is not null and v_count>=v_user_limit then
     raise exception 'وصلت إلى الحد الأقصى للمستخدمين في باقتك';
   end if;
 end if;
 return new;
end;
$function$;

drop trigger if exists miqyas_limit_branches on public.branches;
drop trigger if exists miqyas_subscription_limit_branches on public.branches;
create trigger miqyas_subscription_limit_branches before insert on public.branches
for each row execute function public.miqyas_enforce_subscription_limits();
drop trigger if exists miqyas_subscription_limit_ecommerce_stores on public.ecommerce_stores;
create trigger miqyas_subscription_limit_ecommerce_stores before insert on public.ecommerce_stores
for each row execute function public.miqyas_enforce_subscription_limits();
drop trigger if exists miqyas_limit_organization_members on public.organization_members;
drop trigger if exists miqyas_subscription_limit_members on public.organization_members;
create trigger miqyas_subscription_limit_members before insert on public.organization_members
for each row execute function public.miqyas_enforce_subscription_limits();

commit;

select code,name,business_type,price_sar,branch_limit,max_users,is_active
from public.subscription_plans
where code in ('basic','professional','enterprise','ecom_basic','ecom_professional','ecom_enterprise')
order by business_type,price_sar;
