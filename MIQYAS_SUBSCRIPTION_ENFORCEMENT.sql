-- MIQYAS: فرض الاشتراك وحدود الباقات من قاعدة البيانات
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- لا يحذف أي بيانات ولا ينشئ اشتراكات للعملاء.

begin;

-- توحيد أسعار وحدود الباقات المعتمدة.
alter table public.subscription_plans
  add column if not exists max_users integer;

update public.subscription_plans set price_sar=99, branch_limit=1, max_users=3 where code='basic';
update public.subscription_plans set price_sar=199, branch_limit=5, max_users=10 where code='professional';
update public.subscription_plans set price_sar=399, branch_limit=20, max_users=30 where code='enterprise';

-- دالة موثوقة للتحقق من وجود اشتراك نشط وساري.
create or replace function public.miqyas_has_active_subscription(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_subscriptions s
    where s.organization_id = p_organization_id
      and s.status = 'active'
      and s.starts_at <= now()
      and (s.ends_at is null or s.ends_at > now())
  );
$$;

revoke all on function public.miqyas_has_active_subscription(uuid) from public;
grant execute on function public.miqyas_has_active_subscription(uuid) to authenticated;

-- السماح لمدير المنصة بالمتابعة، وإلزام بقية المستخدمين باشتراك فعال.
-- السياسات RESTRICTIVE تعمل بالإضافة إلى سياسات العضوية الحالية ولا تستبدلها.
drop policy if exists "miqyas active subscription required branches" on public.branches;
create policy "miqyas active subscription required branches"
on public.branches as restrictive for all to authenticated
using (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id))
with check (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id));

drop policy if exists "miqyas active subscription required quality" on public.quality_assessments;
create policy "miqyas active subscription required quality"
on public.quality_assessments as restrictive for all to authenticated
using (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id))
with check (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id));

drop policy if exists "miqyas active subscription required feedback reads" on public.customer_feedback;
create policy "miqyas active subscription required feedback reads"
on public.customer_feedback as restrictive for all to authenticated
using (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id))
with check (public.is_platform_admin() or public.miqyas_has_active_subscription(organization_id));

-- فرض حد الفروع عند الإدخال حتى لو استُدعيت قاعدة البيانات مباشرة.
create or replace function public.miqyas_enforce_subscription_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_code text;
  v_branch_limit integer;
  v_user_limit integer;
  v_count integer;
begin
  if auth.uid() is not null and public.is_platform_admin() then
    return new;
  end if;

  select s.plan_code, p.branch_limit, p.max_users
    into v_plan_code, v_branch_limit, v_user_limit
  from public.organization_subscriptions s
  join public.subscription_plans p on p.code=s.plan_code
  where s.organization_id=new.organization_id
    and s.status='active'
    and s.starts_at <= now()
    and (s.ends_at is null or s.ends_at > now())
  order by s.created_at desc
  limit 1;

  if tg_table_name='branches' then
    if v_plan_code is null then
      raise exception 'يلزم وجود اشتراك فعال لإضافة فرع';
    end if;
    select count(*) into v_count from public.branches where organization_id=new.organization_id;
    if v_branch_limit is not null and v_count >= v_branch_limit then
      raise exception 'وصلت منشأتك إلى الحد الأقصى للفروع في باقتك. يرجى ترقية الباقة.';
    end if;
  elsif tg_table_name='organization_members' then
    select count(*) into v_count from public.organization_members where organization_id=new.organization_id;
    -- يسمح بعضوية المالك الأول فقط قبل الاشتراك، ويمنع إضافة مستخدمين إضافيين.
    if v_plan_code is null then
      if v_count >= 1 then
        raise exception 'إضافة مستخدمين إضافيين تتطلب اشتراكاً فعالاً.';
      end if;
    elsif v_user_limit is not null and v_count >= v_user_limit then
      raise exception 'وصلت منشأتك إلى الحد الأقصى للمستخدمين في باقتك. يرجى ترقية الباقة.';
    end if;
  end if;
  return new;
end;
$$;

-- إزالة المشغلات السابقة التي تحمل الاسم نفسه ثم إنشاؤها.
drop trigger if exists miqyas_limit_branches on public.branches;
create trigger miqyas_limit_branches
before insert on public.branches
for each row execute function public.miqyas_enforce_subscription_limits();

drop trigger if exists miqyas_limit_organization_members on public.organization_members;
create trigger miqyas_limit_organization_members
before insert on public.organization_members
for each row execute function public.miqyas_enforce_subscription_limits();

commit;

-- فحص سريع لأسعار وحدود الباقات بعد التنفيذ:
select code, price_sar, branch_limit, max_users
from public.subscription_plans
where code in ('basic','professional','enterprise')
order by price_sar;
