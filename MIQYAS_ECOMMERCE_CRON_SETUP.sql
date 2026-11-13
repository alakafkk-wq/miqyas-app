-- Optional scheduler setup. Requires pg_cron, pg_net, and Vault enabled in Supabase.
-- First create these three Vault secrets in SQL Editor (replace values locally; never send them in chat):
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'miqyas_supabase_url');
-- select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'miqyas_service_role_key');
-- select vault.create_secret('YOUR_REVIEW_SCHEDULER_SECRET', 'miqyas_review_scheduler_secret');
-- The scheduler secret must exactly match REVIEW_SCHEDULER_SECRET in the Edge Function secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'miqyas-process-ecommerce-review-invites';

select cron.schedule(
  'miqyas-process-ecommerce-review-invites',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'miqyas_supabase_url') || '/functions/v1/process-ecommerce-review-invites',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'miqyas_review_scheduler_secret'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'miqyas_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
