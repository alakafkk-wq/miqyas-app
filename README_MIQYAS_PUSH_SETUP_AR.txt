تفعيل إشعارات طلبات الاشتراك خارج المنصة — MIQYAS

المضاف:
- جدول آمن لحفظ أجهزة مدير المنصة: miqyas_push_subscriptions.
- تسجيل الجهاز عند الضغط على «تفعيل إشعارات الطلبات».
- استقبال إشعار Push عبر Service Worker عندما تكون الصفحة مغلقة.
- Edge Function لإرسال التنبيه عند INSERT في subscription_payment_requests.

الخطوات المطلوبة قبل التشغيل:
1) افتح Supabase > SQL Editor ونفّذ MIQYAS_PUSH_NOTIFICATIONS.sql.

2) أنشئ مفاتيح VAPID على جهاز تطوير موثوق:
   npm install web-push
   npx web-push generate-vapid-keys
   ضع Public Key في VAPID_PUBLIC_KEY داخل config.js.
   لا تضع Private Key في ملفات الموقع أو GitHub.

3) أضف Edge Function Secrets:
   VAPID_PUBLIC_KEY = المفتاح العام
   VAPID_PRIVATE_KEY = المفتاح الخاص
   VAPID_SUBJECT = mailto:miqyassupport@gmail.com
   MIQYAS_PUSH_WEBHOOK_SECRET = قيمة عشوائية طويلة وسرية
   SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (متاحان عادة ضمن بيئة Supabase Functions).

4) انشر supabase/functions/miqyas-push-notify كـ Edge Function.
   عطّل Verify JWT لهذه الوظيفة فقط؛ تتحقق الوظيفة من x-miqyas-webhook-secret.

5) من Supabase > Database > Webhooks أنشئ Webhook:
   Table: public.subscription_payment_requests
   Event: INSERT فقط
   Method: POST
   URL: https://<PROJECT_REF>.supabase.co/functions/v1/miqyas-push-notify
   Header: x-miqyas-webhook-secret: نفس قيمة MIQYAS_PUSH_WEBHOOK_SECRET
   Content-Type: application/json

6) انشر ملفات الموقع بعد وضع المفتاح العام في config.js.
   تأكد أن حسابك موجود في public.platform_admins.
   iPhone: ثبّت MIQYAS من Safari إلى الشاشة الرئيسية، وافتحه من الأيقونة، ثم فعّل الإشعارات واسمح بها.
   Android: افتح MIQYAS في Chrome وثبّته، ثم فعّل الإشعارات واسمح بها.
   كرر تفعيل الإشعارات على كل جهاز ترغب باستقبال التنبيهات عليه.

ملاحظات:
- هذا إشعار بوصول طلب جديد، ولا يعني أن الدفع تم بنجاح.
- لا ترسل VAPID_PRIVATE_KEY أو service role key إلى أي شخص ولا تضعهما في config.js.
- لا يمكن اعتبار الإشعارات جاهزة فعلياً قبل إكمال إعداد Supabase واختبار وصول إشعار تجريبي.
