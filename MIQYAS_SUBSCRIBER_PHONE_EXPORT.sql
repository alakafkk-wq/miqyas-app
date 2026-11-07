-- MIQYAS v1.21.1: secure subscriber contact phone export
-- Run once in Supabase SQL Editor. Read-only; exposes phones only to platform admins.
CREATE OR REPLACE FUNCTION public.miqyas_admin_subscriber_phones()
RETURNS TABLE (organization_id uuid, contact_phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT COALESCE(public.is_platform_admin(), false) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (m.organization_id)
    m.organization_id,
    NULLIF(
      COALESCE(
        u.raw_user_meta_data ->> 'contact_phone',
        u.raw_user_meta_data ->> 'phone'
      ), ''
    ) AS contact_phone
  FROM public.organization_members AS m
  JOIN auth.users AS u ON u.id = m.user_id
  WHERE m.role = 'owner'
  ORDER BY m.organization_id, m.created_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.miqyas_admin_subscriber_phones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.miqyas_admin_subscriber_phones() TO authenticated;
