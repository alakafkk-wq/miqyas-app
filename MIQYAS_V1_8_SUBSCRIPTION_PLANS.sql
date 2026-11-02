-- MIQYAS v1.8: اعتماد أسعار وحدود الباقات
-- آمن: لا يحذف سجلات ولا يغيّر الاشتراكات القائمة أو طلبات الدفع.
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS max_users integer;

UPDATE public.subscription_plans
SET name = 'الأساسية',
    price_sar = 99,
    billing_period_months = 1,
    branch_limit = 1,
    max_users = 3,
    features = '["فرع واحد", "حتى 3 مستخدمين", "مؤشرات الجودة وصوت العميل", "تقارير Excel"]'::jsonb,
    is_active = true
WHERE code = 'basic';

UPDATE public.subscription_plans
SET name = 'الاحترافية',
    price_sar = 199,
    billing_period_months = 1,
    branch_limit = 5,
    max_users = 10,
    features = '["حتى 5 فروع", "حتى 10 مستخدمين", "جميع التقارير والتحليلات", "مقارنة أداء الفروع"]'::jsonb,
    is_active = true
WHERE code = 'professional';

UPDATE public.subscription_plans
SET name = 'المؤسسات',
    price_sar = 399,
    billing_period_months = 1,
    branch_limit = 20,
    max_users = 30,
    features = '["حتى 20 فرعاً", "حتى 30 مستخدماً", "صلاحيات متعددة", "تقارير إدارية متقدمة"]'::jsonb,
    is_active = true
WHERE code = 'enterprise';

-- تحقق من أن رموز الباقات الثلاث موجودة قبل اعتماد التحديث.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.subscription_plans WHERE code IN ('basic','professional','enterprise')) <> 3 THEN
    RAISE EXCEPTION 'لم يتم العثور على الباقات الثلاث الأساسية؛ أوقف التحديث وراجع جدول subscription_plans.';
  END IF;
END $$;

SELECT code, name, price_sar, billing_period_months, branch_limit, max_users, features, is_active
FROM public.subscription_plans
WHERE code IN ('basic','professional','enterprise')
ORDER BY price_sar;
