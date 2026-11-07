MIQYAS v1.21.0 — UPDATE PACKAGE (REQUESTED SCOPE ONLY)

Included changes:
1) JavaScript-rendered dates and number/date displays use Arabic locale with Gregorian calendar (ar-SA-u-ca-gregory).
2) Platform-admin Excel export for subscribers, filtered by created_at date range.
3) Platform-admin Excel export for subscription/payment operations, filtered by created_at date range.
4) Platform-admin Excel export for platform_activity_audit user activity, filtered by created_at date range.
5) Platform-admin overview: organization count, active/trial subscriptions, confirmed payment-request totals, branch count and customer-feedback count.
6) Platform-admin branch monitoring table with organization, branch, city, feedback count, positive/neutral/negative totals and latest feedback date.
7) Mystery Shopper removed from visible service navigation; historical assessment rows are retained and labeled as historical/unavailable.
8) Service worker cache key updated for this release.

Explicitly excluded:
- No owner-only member management changes, no new member-management SQL, and no member-management Edge Function.
- No payment gateway changes.
- No production database changes or SQL execution.

Important deployment and verification notes:
- Excel export depends on the XLSX library loaded by index.html.
- User activity export depends on public.platform_activity_audit being present and readable by the platform administrator. If MIQYAS_ACTIVITY_AUDIT.sql has not already been applied in the project, review and apply it separately only after backup and approval.
- Platform-wide queries depend on existing Supabase RLS policies granting the platform administrator the required read access. This package does not modify RLS.
- Revenue total is calculated only from subscription_payment_requests rows whose status is 'paid' or 'approved'. Confirm that these statuses represent settled/collected funds in the live payment workflow before financial reporting.
- Date range filters use the selected start/end dates against each report's created_at field.
- The branch monitoring view currently covers branches and customer_feedback; it does not present ecommerce store review analytics.
- JavaScript syntax check passed with node --check app.js. No live Supabase, browser end-to-end, payment, email, or production deployment test was performed.

This is an update package for review and staging validation, not a claim of production certification. Back up the current deployment before replacing files. Keep the current production version until staging checks pass.
