MIQYAS v1.21.1 UI update

Changes:
- Owner member management is now a compact collapsible section with the user quota visible in its summary.
- Added a notification bell and accessible popover in the header. Existing realtime notification channel remains unchanged.
- Subscriber Excel export includes owner contact phone via the secure RPC.

Required before using the phone column:
1. Run MIQYAS_SUBSCRIBER_PHONE_EXPORT.sql in Supabase SQL Editor.
2. The function is read-only and only returns owner phone metadata to platform admins.
3. Existing accounts show a phone only if contact_phone or phone exists in auth user metadata.
4. No payment gateway settings or existing records are changed.

No GitHub push or production deployment was performed.
