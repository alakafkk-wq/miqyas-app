-- MIQYAS v1.4: Google Maps branch link (safe additive migration)
-- Run this in Supabase SQL Editor before uploading the updated frontend.
alter table public.branches
  add column if not exists google_maps_url text;

comment on column public.branches.google_maps_url is
  'Public Google Maps URL for the branch. Used as an external link in MIQYAS.';
