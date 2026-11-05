مقياس MIQYAS – تحديث v1.15 (QR موقع Google Maps + بيانات التواصل)

ما الجديد:
1) عند حفظ رابط Google Maps صحيح للفرع، يظهر بجانب الفرع زر "QR موقع Google Maps".
2) الضغط على الزر ينشئ QR منفصلاً يفتح موقع الفرع على Google Maps مباشرةً.
3) يبقى زر "QR التقييم" الحالي كما هو ولا يتغير مساره؛ أصبح لكل فرع نوعان مستقلان من QR: موقع Maps والتقييم.
4) يظهر بريد التواصل تلقائياً على mailto:miqyassupport@gmail.com إذا لم يُحدّد CONTACT_EMAIL في config.js.
5) أيقونة WhatsApp موجودة وتظهر بعد إدخال رقم واتساب الحقيقي بصيغة دولية أرقام فقط في WHATSAPP_NUMBER.
6) تم تحديث اسم ذاكرة التخزين المؤقت في sw.js لضمان تحميل النسخة الجديدة.

ملفات التحديث:
- استبدل app.js و index.html و sw.js فقط.
- لا تستبدل config.js أو أي مفاتيح Supabase أو ملفات SQL.
- لا توجد تغييرات على قاعدة البيانات؛ الحقل branches.google_maps_url مستخدم بالفعل.

إعداد التواصل:
أبقِ كائن window.MIQYAS_CONFIG الحالي في config.js كما هو، وأضف/عدّل الحقول التالية داخله:
CONTACT_EMAIL: "miqyassupport@gmail.com",
WHATSAPP_NUMBER: "966530561303"  (رقم الدعم الذي زوّدني به المستخدم؛ أرقام فقط بدون + أو مسافات)
لا تضع مفاتيح سرية في config.js.

الاختبار:
1) انشر الملفات الثلاثة في نفس مسار ملفات الواجهة.
2) افتح المنصة وسجّل الدخول.
3) أضف فرعاً وضع رابط Google Maps كاملاً يبدأ بـ https://.
4) من قائمة الفروع اضغط "QR موقع Google Maps" وامسح الرمز للتأكد أنه يفتح رابط Maps.
5) جرّب "QR التقييم" للتأكد أن رابط تقييم العميل ما زال يعمل منفصلاً.
6) اضغط أيقونة البريد للتأكد أنها تفتح رسالة إلى miqyassupport@gmail.com.
7) تم ضبط رقم واتساب 966530561303 كقيمة افتراضية داخل app.js؛ ويمكن تغييره لاحقاً من config.js عبر WHATSAPP_NUMBER. اضغط أيقونة واتساب للتأكد من فتح المحادثة الصحيحة.

ملاحظة: QR موقع Google Maps يفتح الرابط الذي أدخله المستخدم؛ لا يجلب تقييمات Google أو المراجعات تلقائياً.


MIQYAS v1.16 update:
- Added Home button to return to dashboard from service sections.
- Added Supabase Auth password reset email flow and password update form.
- Improved subscription request notifications through Service Worker notifications while app is open/connected.
- Push notifications while the app is fully closed require VAPID push server setup and subscription storage; this package does not claim background push is configured.
- Configure Supabase Auth URL allow-list to include the exact site URL with ?reset-password=1.
\n\nMIQYAS v1.17 branch deletion:\n- Added a Delete Branch control to each branch card.\n- Requires explicit confirmation.\n- Checks quality_assessments and customer_feedback first; if records exist, deletion is blocked to preserve history and the user is advised to archive instead.\n- Deletes only the branch belonging to the current organization.\n

MIQYAS v1.18 Activity Audit Log:
1) Run MIQYAS_ACTIVITY_AUDIT.sql in Supabase SQL Editor.
2) Deploy index.html and app.js from this package; keep config.js unchanged.
3) The Platform Admin panel displays the latest 200 activity events.
4) Events are captured for organizations, branches, quality_assessments, customer_feedback, ecommerce_stores, organization_subscriptions and subscription_payment_requests when those tables exist.
5) Successful sign-in events are recorded through the log_platform_login() RPC; credentials and tokens are never stored.
\n\nMIQYAS v1.18.3 — Subscription audit display update\n- The admin subscription audit now reads directly from subscription_payment_requests and organization_subscriptions.\n- No database schema changes or SQL execution are required.\n- Service worker cache version updated to force fresh app.js and sw.js assets.\n