-- MIQYAS Ecommerce Reviews - additive migration
-- Run once in Supabase SQL Editor after taking a database backup.
BEGIN;

-- Multi-store Salla mapping. Additive only; preserves existing store records.
ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS salla_merchant_id text;

CREATE TABLE IF NOT EXISTS public.ecommerce_store_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'salla' CHECK (provider IN ('salla')),
  authorization_token text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  zid_store_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


ALTER TABLE public.ecommerce_review_invites
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

ALTER TABLE public.ecommerce_store_credentials
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ecommerce_store_credentials ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ecommerce_stores_salla_merchant_idx
  ON public.ecommerce_stores (salla_merchant_id) WHERE salla_merchant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ecommerce_orders_delivered_due_idx
  ON public.ecommerce_orders (delivered_at)
  WHERE delivered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ecommerce_invites_retry_due_idx
  ON public.ecommerce_review_invites (invite_status, next_attempt_at)
  WHERE invite_status = 'created';

CREATE INDEX IF NOT EXISTS ecommerce_invites_org_store_created_idx
  ON public.ecommerce_review_invites (organization_id, store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ecommerce_review_invite_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  invite_id uuid REFERENCES public.ecommerce_review_invites(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('created','sent','failed','skipped','completed')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ecommerce_review_invite_logs_store_date_idx
  ON public.ecommerce_review_invite_logs (store_id, created_at DESC);

ALTER TABLE public.ecommerce_review_invite_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecommerce_review_invite_logs_org_read ON public.ecommerce_review_invite_logs;
CREATE POLICY ecommerce_review_invite_logs_org_read
  ON public.ecommerce_review_invite_logs FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (public.is_org_member(organization_id) AND public.miqyas_has_active_subscription(organization_id)));

-- No client-side write policy. Only trusted Edge Functions using service role write these rows.
COMMIT;

-- Read-only reporting views for store dashboards/exports.
CREATE OR REPLACE VIEW public.ecommerce_store_review_summary
WITH (security_invoker = true) AS
SELECT
  s.id AS store_id,
  s.organization_id,
  s.store_name,
  COUNT(r.id)::bigint AS review_count,
  ROUND(AVG(r.overall_rating)::numeric, 2) AS average_overall_rating,
  ROUND(AVG(r.product_quality)::numeric, 2) AS average_product_quality,
  ROUND(AVG(r.delivery_rating)::numeric, 2) AS average_delivery_rating,
  ROUND(AVG(r.packaging_rating)::numeric, 2) AS average_packaging_rating,
  ROUND(AVG(r.checkout_rating)::numeric, 2) AS average_checkout_rating,
  ROUND(AVG(r.support_rating)::numeric, 2) AS average_support_rating,
  MAX(r.created_at) AS last_review_at
FROM public.ecommerce_stores s
LEFT JOIN public.ecommerce_reviews r ON r.store_id = s.id
GROUP BY s.id, s.organization_id, s.store_name;

CREATE OR REPLACE VIEW public.ecommerce_store_review_details
WITH (security_invoker = true) AS
SELECT
  r.id, r.organization_id, r.store_id, s.store_name,
  o.external_order_id, r.product_quality, r.delivery_rating,
  r.packaging_rating, r.checkout_rating, r.support_rating,
  r.overall_rating, r.comment, r.created_at
FROM public.ecommerce_reviews r
JOIN public.ecommerce_stores s ON s.id = r.store_id
JOIN public.ecommerce_orders o ON o.id = r.order_id;
