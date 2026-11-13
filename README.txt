MIQYAS v1.15 - Moyasar checkout integration

Files to publish to the existing MIQYAS GitHub Pages repository root:
- app.js
- index.html
- sw.js

Keep your existing config.js, style.css, manifest.webmanifest, icon.svg and all other existing assets unchanged.
Do not replace Supabase Edge Function smooth-service.

The subscription form now invokes the deployed Supabase Edge Function named miqyas-moyasar.
The browser redirects to the checkout_url returned by that function.

Important: this frontend patch is prepared but not yet tested end-to-end against a successful Moyasar sandbox payment. Test with Moyasar test mode first.


Update v1.21.5: branch feedback anti-duplicate protection without OTP. See README_BRANCH_FEEDBACK_ANTI_DUPLICATE_AR.txt.
