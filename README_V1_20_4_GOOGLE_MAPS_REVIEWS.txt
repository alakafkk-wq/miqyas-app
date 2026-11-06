MIQYAS v1.20.4 – Google Maps Reviews

التعديلات:
- إضافة زر "تحديث تقييمات Google Maps" لكل فرع لديه رابط Google Maps.
- إضافة قسم يعرض آخر ملخص وتقييمات Google المتاحة.
- حفظ لقطة النتائج في google_maps_review_snapshots.
- خدمة Edge Function آمنة؛ مفتاح Google لا يظهر في ملفات المتصفح.
- لم يتم تغيير إنشاء QR أو رابط التقييم الحالي.

خطوات التفعيل:
1) نفّذ MIQYAS_V1_20_4_GOOGLE_MAPS_REVIEWS.sql في Supabase SQL Editor.
2) في Google Cloud فعّل Places API (New) وأنشئ API Key مع تقييد المفتاح على Places API.
3) من Supabase CLI اربط المشروع ثم انشر الدالة:
   supabase functions deploy google-maps-reviews
4) أضف السر إلى Supabase Functions Secrets:
   GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY
   (SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY متاحة عادة كأسرار افتراضية في Edge Functions.)
5) افتح MIQYAS، ومن بطاقة الفرع اضغط "تحديث تقييمات Google Maps".

تنبيه دقة:
- تستخدم الدالة اسم الفرع والمنطقة والمدينة للبحث عبر Places Text Search. قبل الاعتماد التجاري، راجع اسم الموقع الناتج في Google وتأكد أنه نفس الفرع المقصود.
- Places API يعيد حتى 5 مراجعات مختارة، ولا يعيد سجل كل المراجعات.
- لا نقوم بكشط صفحات Google Maps أو تجاوز قيود Google.
- للحصول على كل مراجعات منشأة يملكها العميل، يلزم مسار Google Business Profile API مع OAuth وصلاحية إدارة الموقع، وهو تكامل مستقل يحتاج إعداد موافقة OAuth.
