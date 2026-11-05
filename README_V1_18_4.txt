MIQYAS v1.18.4 — Moyasar online checkout restoration

Files to replace in the GitHub repository root:
- app.js
- index.html
- sw.js

What changed:
- Restored the existing Supabase Edge Function checkout call to miqyas-moyasar.
- Sends action=create_invoice, organization_id, and plan_code.
- Redirects the customer to the returned checkout_url.
- Keeps bank transfer disabled; only online payment is offered.
- Subscription activation remains server-side after verified payment through the existing webhook/RPC flow.
- Updated service-worker cache name to force fresh assets.

No SQL changes and no secret keys are required in the website files. The Moyasar secret remains stored server-side in Supabase.
