-- MIQYAS v1.14: real-time alerts for new subscription requests
-- Safe and idempotent. Run once in Supabase SQL Editor.
-- This enables database change events; the platform admin must also allow browser notifications.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'subscription_payment_requests'
    ) then
      alter publication supabase_realtime add table public.subscription_payment_requests;
    end if;
  end if;
end
$$;

-- Check that the table is included in Realtime:
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'subscription_payment_requests';
