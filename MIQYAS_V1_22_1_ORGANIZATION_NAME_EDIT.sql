-- MIQYAS v1.22.1 - Organization name editing
-- Run once in Supabase SQL Editor.
begin;

create or replace function public.miqyas_update_organization_name(
  p_organization_id uuid,
  p_new_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;

  if nullif(trim(p_new_name), '') is null then
    raise exception 'اسم المنشأة مطلوب';
  end if;

  if char_length(trim(p_new_name)) > 120 then
    raise exception 'اسم المنشأة يجب ألا يتجاوز 120 حرفاً';
  end if;

  if not (
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  ) then
    raise exception 'تعديل اسم المنشأة متاح لمالك المنشأة فقط';
  end if;

  update public.organizations
  set name = trim(p_new_name)
  where id = p_organization_id
  returning name into v_name;

  if v_name is null then
    raise exception 'المنشأة غير موجودة';
  end if;

  return v_name;
end;
$function$;

revoke all on function public.miqyas_update_organization_name(uuid,text) from public;
grant execute on function public.miqyas_update_organization_name(uuid,text) to authenticated;

commit;
