-- MIQYAS: enforce one organization per authenticated account
-- Safe migration: blocks future duplicate organization creation; does not delete existing organizations.
CREATE OR REPLACE FUNCTION public.create_organization(
    org_name text,
    org_industry text DEFAULT 'other'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_org uuid;
    v_type text;
    v_plan text;
    v_sub uuid;
    v_start timestamptz := now();
    v_end timestamptz := now() + interval '5 days';
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF nullif(trim(org_name), '') IS NULL THEN
        RAISE EXCEPTION 'Organization name is required';
    END IF;

    -- Prevent concurrent requests from creating two organizations for one account.
    PERFORM pg_advisory_xact_lock(
        hashtextextended((SELECT auth.uid())::text, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.organization_members m
        WHERE m.user_id = (SELECT auth.uid())
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'هذا الحساب لديه منشأة مسجلة بالفعل. يرجى تسجيل الدخول إلى المنشأة الحالية. لإنشاء منشأة إضافية، يرجى التواصل مع مدير المنصة.';
    END IF;

    v_type := CASE
        WHEN (SELECT auth.jwt()->'user_metadata'->>'business_type') = 'ecommerce'
        THEN 'ecommerce'
        ELSE 'branches'
    END;
    v_plan := CASE WHEN v_type = 'ecommerce' THEN 'ecom_basic' ELSE 'basic' END;

    INSERT INTO public.organizations(name, industry, business_type)
    VALUES (trim(org_name), coalesce(org_industry, 'other'), v_type)
    RETURNING id INTO v_org;

    INSERT INTO public.organization_members(organization_id, user_id, role)
    VALUES (v_org, (SELECT auth.uid()), 'owner');

    INSERT INTO public.organization_subscriptions
        (organization_id, plan_code, status, starts_at, ends_at, payment_method)
    VALUES
        (v_org, v_plan, 'trial', v_start, v_end, 'manual')
    RETURNING id INTO v_sub;

    INSERT INTO public.platform_subscription_grants
        (organization_id, subscription_id, grant_type, plan_code,
         starts_at, ends_at, reason, actor_id)
    VALUES
        (v_org, v_sub, 'trial', v_plan, v_start, v_end,
         'تجربة مجانية تلقائية لمدة 5 أيام', NULL);

    RETURN v_org;
END;
$function$;
