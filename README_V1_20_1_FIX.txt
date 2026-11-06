MIQYAS v1.20.1 – Signup and Saudi phone validation fix

Changes:
1. Added a business type selector (Branches / Ecommerce) to the organization workspace creation screen.
2. Preselects the organization type from the authenticated user's metadata when available.
3. Saves contact_phone and business_type to Supabase Auth user metadata before organization creation.
4. Refreshes the auth session after updating metadata so the create_organization RPC receives the latest JWT claims.
5. Corrected Saudi mobile number normalization/validation for 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX and +9665XXXXXXXX formats.
6. Kept existing payment gateway configuration and Paylink/Moyasar flows unchanged.

Validation:
- app.js passed `node --check`.
- Saudi phone normalization tested with 0530402551 and international formats.
- Supabase deployment and live registration have not been performed from this package.
