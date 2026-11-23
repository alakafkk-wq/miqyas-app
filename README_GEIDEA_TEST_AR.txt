MIQYAS – حزمة ربط Geidea للاختبار فقط

المحتويات:
- app.js / app.html: ربط زر الاشتراك بوظيفة miqyas-geidea وإطلاق مكتبة Geidea Checkout الرسمية لبيئة KSA.
- supabase/functions/miqyas-geidea-callback/index.ts: استقبال callback والتحقق من توقيعه ونتيجة العملية.
- MIQYAS_GEIDEA_CALLBACK_AND_INVOICES.sql: ترحيل إضافي لإنشاء سجل الفاتورة وتفعيل الاشتراك بشكل ذري ومنع التكرار.

قبل النشر:
1) خذ نسخة احتياطية من قاعدة البيانات والملفات الحالية.
2) راجع أن وظيفة miqyas-geidea الحالية منشورة وتحتوي أسرار GEIDEA_PUBLIC_KEY وGEIDEA_API_PASSWORD.
3) انشر وظيفة miqyas-geidea-callback من المسار المرفق مع تعطيل التحقق التلقائي من JWT للـ webhook فقط (Supabase CLI: supabase functions deploy miqyas-geidea-callback --no-verify-jwt). لا تعطّل JWT لوظيفة miqyas-geidea.
4) نفّذ ملف SQL مرة واحدة في Supabase SQL Editor بعد مراجعة النسخة الاحتياطية.
5) انشر app.html وapp.js وبقية ملفات الموقع في بيئة الاختبار فقط.
6) اختبر بطاقة نجاح واحدة ثم تحقق من حالة paid وظهور سجل subscription_invoices واشتراك نشط.

تنبيه: لا تنشر إلى الإنتاج ولا تستخدم بطاقات حقيقية قبل نجاح الاختبار. هذا الإصدار لا يرسل الفاتورة بالبريد؛ ينشئ سجل فاتورة داخل قاعدة البيانات فقط. لم يتم التحقق من إعدادات ضريبة القيمة المضافة/الفوترة الإلكترونية، لذلك السجل ليس فاتورة ضريبية معتمدة.
