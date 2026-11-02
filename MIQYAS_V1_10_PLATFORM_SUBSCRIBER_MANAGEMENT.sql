-- MIQYAS v1.10: إدارة المشتركين لمدير المنصة فقط
-- يشمل عرض الاشتراكات وتعديلها وإيقافها مؤقتاً وإعادة تفعيلها وحذف سجل الاشتراك فقط.
-- لا يحذف هذا التحديث المنشآت أو الفروع أو المستخدمين أو التقييمات أو طلبات الدفع.
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.

begin;

-- السماح لمدير المنصة بقراءة أسماء جميع المنشآت عند عرض قائمة المشتركين.
drop policy if exists "platform admins read all organizations" on public.organizations;
create policy "platform admins read all organizations"
on public.organizations for select to authenticated
using (public.is_platform_admin());

-- إضافة حالة الإيقاف المؤقت إلى حالات الاشتراك.
alter table public.organization_subscriptions
  drop constraint if exists organization_subscriptions_status_check;
alter table public.organization_subscriptions
  add constraint organization_subscriptions_status_check
  check (status in ('trial','active','paused','past_due','expired','cancelled'));

-- سجل تدقيق مستقل يبقى حتى بعد حذف سجل الاشتراك.
create table if not exists public.platform_subscription_audit (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid,
  organization_id uuid,
  organization_name text,
  action text not null check (action in ('update','pause','reactivate','delete')),
  old_data jsonb,
  new_data jsonb,
  reason text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists platform_subscription_audit_created_idx
  on public.platform_subscription_audit(created_at desc);
create index if not exists platform_subscription_audit_org_idx
  on public.platform_subscription_audit(organization_id, created_at desc);

alter table public.platform_subscription_audit enable row level security;
drop policy if exists "platform admins read subscription audit" on public.platform_subscription_audit;
create policy "platform admins read subscription audit"
on public.platform_subscription_audit for select to authenticated
using (public.is_platform_admin());

create or replace function public.platform_manage_subscription(
  p_subscription_id uuid,
  p_action text,
  p_plan_code text default null,
  p_status text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.organization_subscriptions%rowtype;
  v_new public.organization_subscriptions%rowtype;
  v_org_name text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'هذه العملية متاحة لمدير المنصة فقط';
  end if;

  if p_action not in ('update','pause','reactivate','delete') then
    raise exception 'نوع العملية غير مدعوم';
  end if;

  select * into v_sub
  from public.organization_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    raise exception 'الاشتراك غير موجود أو سبق حذفه';
  end if;

  select name into v_org_name
  from public.organizations
  where id = v_sub.organization_id;

  if p_action = 'update' then
    if p_plan_code is null or not exists (
      select 1 from public.subscription_plans where code = p_plan_code
    ) then
      raise exception 'اختر باقة صحيحة';
    end if;
    if p_status is null or p_status not in ('trial','active','paused','past_due','expired','cancelled') then
      raise exception 'حالة الاشتراك غير صحيحة';
    end if;
    if p_starts_at is null then
      raise exception 'تاريخ بداية الاشتراك مطلوب';
    end if;
    if p_ends_at is not null and p_ends_at < p_starts_at then
      raise exception 'تاريخ نهاية الاشتراك لا يمكن أن يسبق تاريخ البداية';
    end if;

    update public.organization_subscriptions
    set plan_code = p_plan_code,
        status = p_status,
        starts_at = p_starts_at,
        ends_at = p_ends_at
    where id = p_subscription_id
    returning * into v_new;

  elsif p_action = 'pause' then
    update public.organization_subscriptions
    set status = 'paused'
    where id = p_subscription_id
    returning * into v_new;

  elsif p_action = 'reactivate' then
    update public.organization_subscriptions
    set status = 'active'
    where id = p_subscription_id
    returning * into v_new;

  elsif p_action = 'delete' then
    delete from public.organization_subscriptions
    where id = p_subscription_id;
  end if;

  insert into public.platform_subscription_audit(
    subscription_id, organization_id, organization_name, action,
    old_data, new_data, reason, actor_id, actor_email
  ) values (
    p_subscription_id, v_sub.organization_id, v_org_name, p_action,
    to_jsonb(v_sub),
    case when p_action = 'delete' then null else to_jsonb(v_new) end,
    nullif(trim(p_reason), ''),
    auth.uid(),
    auth.jwt() ->> 'email'
  );
end;
$$;

revoke all on function public.platform_manage_subscription(uuid,text,text,text,timestamptz,timestamptz,text) from public;
grant execute on function public.platform_manage_subscription(uuid,text,text,text,timestamptz,timestamptz,text) to authenticated;

commit;

-- تحقق بعد التنفيذ:
select status, count(*) as subscriptions
from public.organization_subscriptions
group by status
order by status;

select action, count(*) as operations
from public.platform_subscription_audit
group by action
order by action;
