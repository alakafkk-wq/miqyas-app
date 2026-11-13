-- MIQYAS: balanced duplicate protection for branch public feedback (no OTP)
-- Run once in Supabase SQL Editor. Existing feedback rows are not modified.

CREATE TABLE IF NOT EXISTS public.feedback_device_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  last_submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_device_limits_branch_device_key UNIQUE (branch_id, device_hash)
);

CREATE INDEX IF NOT EXISTS feedback_device_limits_branch_time_idx
  ON public.feedback_device_limits (branch_id, last_submitted_at DESC);

ALTER TABLE public.feedback_device_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feedback_device_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feedback_device_limits TO service_role;

-- Ensure the existing phone-limit table is not directly accessible to public clients.
REVOKE ALL ON TABLE public.feedback_submission_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feedback_submission_limits TO service_role;

CREATE OR REPLACE FUNCTION public.submit_branch_feedback_guarded(
  p_token uuid,
  p_rating text,
  p_comment text,
  p_phone_hash text,
  p_device_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch public.branches%ROWTYPE;
  v_id uuid;
  v_phone_lock bigint;
  v_device_lock bigint;
  v_first_lock bigint;
  v_second_lock bigint;
BEGIN
  IF p_rating NOT IN ('positive','neutral','negative') THEN
    RAISE EXCEPTION 'اختيار التقييم غير صالح' USING ERRCODE = '22023';
  END IF;
  IF p_comment IS NOT NULL AND char_length(p_comment) > 500 THEN
    RAISE EXCEPTION 'الملاحظة أطول من الحد المسموح' USING ERRCODE = '22023';
  END IF;
  IF p_phone_hash IS NULL OR p_phone_hash !~ '^[a-f0-9]{64}$'
     OR p_device_hash IS NULL OR p_device_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'بيانات التحقق غير صالحة' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_branch
  FROM public.branches
  WHERE public_token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'رابط التقييم غير صالح' USING ERRCODE = 'P0002';
  END IF;

  -- Deterministic transaction locks serialize simultaneous submissions for either identity.
  v_phone_lock := hashtextextended('phone:' || v_branch.id::text || ':' || p_phone_hash, 0);
  v_device_lock := hashtextextended('device:' || v_branch.id::text || ':' || p_device_hash, 0);
  IF v_phone_lock < v_device_lock THEN
    v_first_lock := v_phone_lock; v_second_lock := v_device_lock;
  ELSE
    v_first_lock := v_device_lock; v_second_lock := v_phone_lock;
  END IF;
  PERFORM pg_advisory_xact_lock(v_first_lock);
  PERFORM pg_advisory_xact_lock(v_second_lock);

  IF EXISTS (
    SELECT 1 FROM public.feedback_submission_limits
    WHERE branch_id = v_branch.id AND phone_hash = p_phone_hash
      AND last_submitted_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'سبق لك تقييم هذا الفرع خلال آخر 24 ساعة.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.feedback_device_limits
    WHERE branch_id = v_branch.id AND device_hash = p_device_hash
      AND last_submitted_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'تم إرسال تقييم من هذا الجهاز لهذا الفرع خلال آخر 24 ساعة.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.customer_feedback
    (organization_id, branch_id, rating, comment, phone_hash)
  VALUES
    (v_branch.organization_id, v_branch.id, p_rating, nullif(trim(p_comment), ''), p_phone_hash)
  RETURNING id INTO v_id;

  INSERT INTO public.feedback_submission_limits
    (organization_id, branch_id, phone_hash, last_submitted_at)
  VALUES (v_branch.organization_id, v_branch.id, p_phone_hash, now())
  ON CONFLICT (branch_id, phone_hash)
  DO UPDATE SET last_submitted_at = EXCLUDED.last_submitted_at,
                organization_id = EXCLUDED.organization_id;

  INSERT INTO public.feedback_device_limits
    (organization_id, branch_id, device_hash, last_submitted_at)
  VALUES (v_branch.organization_id, v_branch.id, p_device_hash, now())
  ON CONFLICT (branch_id, device_hash)
  DO UPDATE SET last_submitted_at = EXCLUDED.last_submitted_at,
                organization_id = EXCLUDED.organization_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_branch_feedback_guarded(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_branch_feedback_guarded(uuid,text,text,text,text)
  TO service_role;

-- Close the legacy public insert path so clients cannot bypass the new guard.
-- The updated website must be deployed together with this migration.
REVOKE ALL ON FUNCTION public.submit_public_feedback(uuid,text,text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.submit_branch_feedback_guarded(uuid,text,text,text,text) IS
  'Accepts branch feedback only after server-side phone/device HMAC checks; service_role only.';
