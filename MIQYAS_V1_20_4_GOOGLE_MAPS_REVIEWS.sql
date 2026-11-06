-- MIQYAS v1.20.4 Google Maps review snapshots
-- Safe additive migration: stores the latest imported Google Places snapshot per branch.
CREATE TABLE IF NOT EXISTS public.google_maps_review_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  place_id text NOT NULL,
  place_name text,
  rating numeric(2,1),
  user_rating_count integer NOT NULL DEFAULT 0,
  reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);

ALTER TABLE public.google_maps_review_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read google maps snapshots"
ON public.google_maps_review_snapshots;

CREATE POLICY "org members read google maps snapshots"
ON public.google_maps_review_snapshots
FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

-- Writes are performed only by the Edge Function using the service role key.
REVOKE INSERT, UPDATE, DELETE ON public.google_maps_review_snapshots FROM anon, authenticated;
GRANT SELECT ON public.google_maps_review_snapshots TO authenticated;
