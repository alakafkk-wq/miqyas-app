-- MIQYAS v1.21.2 - إدارة استعراض المشتركين وحذف المتجر بأمان
-- شغّله مرة واحدة في Supabase SQL Editor بعد أخذ نسخة احتياطية.
-- لا يحذف أي منشأة أو فرع. حذف المتجر يزيل السجلات التابعة له فقط.

begin;

create or replace function public.platform_delete_ecommerce_store(
  p_store_id uuid,
  p_confirm_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.ecommerce_stores%rowtype;
  v_is_admin boolean := false;
  v_is_owner boolean := false;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;

  select * into v_store
  from public.ecommerce_stores
  where id = p_store_id
  for update;

  if not found then
    raise exception 'المتجر غير موجود أو سبق حذفه';
  end if;

  v_is_admin := coalesce(public.is_platform_admin(), false);

  if not v_is_admin then
    select exists (
      select 1
      from public.organization_members m
      where m.organization_id = v_store.organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    ) into v_is_owner;
  end if;

  if not (v_is_admin or v_is_owner) then
    raise exception 'حذف المتجر متاح لمدير المنصة أو مالك المنشأة فقط';
  end if;

  if coalesce(trim(p_confirm_name), '') <> v_store.store_name then
    raise exception 'اسم المتجر غير مطابق للتأكيد';
  end if;

  -- حذف البيانات التابعة صراحةً حتى لا يعتمد الإجراء على إعدادات CASCADE.
  delete from public.ecommerce_reviews where store_id = v_store.id;
  delete from public.ecommerce_review_invites where store_id = v_store.id;
  delete from public.ecommerce_orders where store_id = v_store.id;
  delete from public.ecommerce_store_credentials where store_id = v_store.id;
  delete from public.ecommerce_stores where id = v_store.id;

  return 'تم حذف المتجر وسجلاته التابعة بنجاح';
end;
$$;

revoke all on function public.platform_delete_ecommerce_store(uuid, text) from public;
grant execute on function public.platform_delete_ecommerce_store(uuid, text) to authenticated;

commit;
