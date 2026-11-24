حزمة MIQYAS - مزامنة Callback وSQL لبوابة Geidea (فرع اختبار)

الملفات:
- supabase/functions/miqyas-geidea-callback/index.ts: وظيفة استقبال إشعار Geidea والتحقق من توقيع HMAC-SHA256 قبل تأكيد الدفع.
- MIQYAS_GEIDEA_CALLBACK_AND_INVOICES.sql: ترحيل إضافي لإنشاء سجل الفاتورة وتحديث الاشتراك الحالي بصورة قابلة لإعادة الاستدعاء.

قبل التنفيذ:
1. خذ نسخة احتياطية من قاعدة البيانات.
2. راجع بنية الجداول وأسماء الأعمدة في مشروع Supabase الفعلي.
3. تحقق من أسرار SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY وGEIDEA_PUBLIC_KEY وGEIDEA_API_PASSWORD.
4. انشر miqyas-geidea-callback فقط مع --no-verify-jwt للـ webhook، ولا تعطّل JWT لوظيفة miqyas-geidea.
5. نفّذ SQL بعد المراجعة في بيئة الاختبار فقط.
6. اختبر دفعة ناجحة، ثم تحقق من paid وgateway_order_id وpaid_at وسجل فاتورة واحد والاشتراك النشط وتاريخ انتهائه.

ملاحظات مهمة:
- هذا الفرع للمراجعة والاختبار فقط؛ لم يتم نشر وظيفة Supabase ولم يتم تنفيذ SQL.
- لا تحذف وظيفة miqyas-moyasar.
- لا تعتبر عودة المتصفح دليلاً على نجاح الدفع؛ المرجع هو callback موثّق من Geidea.
- سجل الفاتورة داخلي وليس فاتورة ضريبية إلكترونية معتمدة، ولا يتضمن إرسال الفاتورة بالبريد.
- لا تدمج هذا الفرع إلى main قبل إكمال اختبارات التكامل ومراجعة تنسيق توقيع Geidea مع إعداد webhook الفعلي.
