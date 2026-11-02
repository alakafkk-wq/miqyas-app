-- MIQYAS v1.13 - Ecommerce foundation
-- Run in Supabase SQL Editor after reviewing. Does not modify existing business data.
begin;

create table if not exists public.ecommerce_stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_name text not null check (length(trim(store_name)) between 2 and 120),
  platform text not null check (platform in ('salla','zid','shopify','woocommerce','custom')),
  store_url text not null,
  connection_status text not null default 'pending'
    check (connection_status in ('pending','connected','error','paused')),
  created_at timestamptz not null default now(),
  unique (organization_id, store_url)
);

create table if not exists public.ecommerce_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.ecommerce_stores(id) on delete cascade,
  external_order_id text not null,
  order_status text not null default 'created',
  customer_email text,
  customer_phone text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, external_order_id)
);

create table if not exists public.ecommerce_review_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.ecommerce_stores(id) on delete cascade,
  order_id uuid not null references public.ecommerce_orders(id) on delete cascade,
  token_hash text not null unique,
  invite_status text not null default 'created'
    check (invite_status in ('created','sent','completed','expired')),
  sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.ecommerce_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.ecommerce_stores(id) on delete cascade,
  order_id uuid not null unique references public.ecommerce_orders(id) on delete cascade,
  product_quality smallint not null check (product_quality between 1 and 5),
  delivery_rating smallint not null check (delivery_rating between 1 and 5),
  packaging_rating smallint not null check (packaging_rating between 1 and 5),
  checkout_rating smallint not null check (checkout_rating between 1 and 5),
  support_rating smallint not null check (support_rating between 1 and 5),
  overall_rating smallint not null check (overall_rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1500),
  created_at timestamptz not null default now()
);

alter table public.ecommerce_stores enable row level security;
alter table public.ecommerce_orders enable row level security;
alter table public.ecommerce_review_invites enable row level security;
alter table public.ecommerce_reviews enable row level security;

drop policy if exists ecommerce_stores_org_read on public.ecommerce_stores;
create policy ecommerce_stores_org_read on public.ecommerce_stores
for select to authenticated
using (public.is_platform_admin() or public.is_org_member(organization_id));

drop policy if exists ecommerce_stores_org_insert on public.ecommerce_stores;
create policy ecommerce_stores_org_insert on public.ecommerce_stores
for insert to authenticated
with check (
  public.is_platform_admin()
  or (public.is_org_member(organization_id)
      and public.miqyas_has_active_subscription(organization_id))
);

drop policy if exists ecommerce_stores_org_update on public.ecommerce_stores;
create policy ecommerce_stores_org_update on public.ecommerce_stores
for update to authenticated
using (public.is_platform_admin() or (public.is_org_member(organization_id) and public.miqyas_has_active_subscription(organization_id)))
with check (public.is_platform_admin() or (public.is_org_member(organization_id) and public.miqyas_has_active_subscription(organization_id)));

drop policy if exists ecommerce_orders_org_read on public.ecommerce_orders;
create policy ecommerce_orders_org_read on public.ecommerce_orders
for select to authenticated
using (public.is_platform_admin() or (public.is_org_member(organization_id) and public.miqyas_has_active_subscription(organization_id)));

drop policy if exists ecommerce_reviews_org_read on public.ecommerce_reviews;
create policy ecommerce_reviews_org_read on public.ecommerce_reviews
for select to authenticated
using (public.is_platform_admin() or (public.is_org_member(organization_id) and public.miqyas_has_active_subscription(organization_id)));

-- No browser-side INSERT policies for orders, invites or reviews.
-- These records must be written by trusted Edge Functions after validating webhook signatures/tokens.
commit;
