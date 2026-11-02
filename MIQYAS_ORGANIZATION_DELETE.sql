-- MIQYAS: صلاحية الحذف النهائي للمنشأة (أنشأها المدير مسبقاً)
-- هذا الملف يعيد إنشاء نفس الوظيفة عند الحاجة؛ لا ينفذ حذفاً عند تشغيله.
BEGIN;
CREATE TABLE IF NOT EXISTS public.platform_organization_deletion_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    organization_name text NOT NULL,
    deleted_by uuid,
    deleted_by_email text,
    deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_organization_deletion_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform admins read deletion audit" ON public.platform_organization_deletion_audit;
CREATE POLICY "platform admins read deletion audit" ON public.platform_organization_deletion_audit
FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE OR REPLACE FUNCTION public.platform_delete_organization(p_organization_id uuid,p_confirm_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_name text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN RAISE EXCEPTION 'الحذف متاح لمدير المنصة فقط'; END IF;
 SELECT name INTO v_name FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'المنشأة غير موجودة'; END IF;
 IF trim(p_confirm_name) <> v_name THEN RAISE EXCEPTION 'اسم المنشأة غير مطابق. تم إلغاء الحذف'; END IF;
 IF EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=auth.uid()) THEN
   RAISE EXCEPTION 'لا يمكن حذف المنشأة المرتبط بها حساب مدير المنصة الحالي';
 END IF;
 INSERT INTO public.platform_organization_deletion_audit(organization_id,organization_name,deleted_by,deleted_by_email)
 VALUES(p_organization_id,v_name,auth.uid(),auth.jwt()->>'email');
 DELETE FROM public.organizations WHERE id=p_organization_id;
 RETURN 'تم حذف المنشأة وجميع بياناتها المرتبطة بنجاح';
END; $$;
REVOKE ALL ON FUNCTION public.platform_delete_organization(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_delete_organization(uuid,text) TO authenticated;
COMMIT;
