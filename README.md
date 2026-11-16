# HIS Team Tracker — متتبع فريق HIS

نظام داخلي لمتابعة تسجيل العاملين في نظام معلومات المستشفى (HIS): فريق الدعم يقيّم كل محاولة تسجيل من نموذج بسيط على الموبايل، والمشرفون يتابعون النقاط والمتابعات والتصعيدات من لوحة التحكم.

Internal tool for tracking staff registration on the hospital HIS. Field team members submit evaluations from a mobile-friendly public form; supervisors follow scores, follow-ups and escalations from the dashboard.

## كيف يعمل (How it works)

| الصفحة | الوظيفة |
| --- | --- |
| `/` | نموذج التقييم (بدون تسجيل دخول): اختيار الموظف ← نتيجة المحاولة ← ملاحظات ← متابعة |
| `/login` | تسجيل دخول الإدارة والمشرفين |
| `/dashboard` | أرقام عامة، من يحتاج انتباهًا، متابعات قادمة، تصعيدات، آخر التقييمات |
| `/staff`, `/staff/[id]` | دليل الموظفين، الملف الشخصي، التعديل، تصفير النقاط، تصدير Excel |
| `/history` | كل التقييمات مع فلاتر وتصدير |
| `/followups` | المتابعات المجدولة (مفتوحة / متأخرة / مكتملة) |
| `/escalations`, `/escalations/[id]` | مراجعة التصعيدات واعتماد الخطاب وطباعته |
| `/analytics` | رسوم بيانية (حسب الوظيفة، الحالة، الأشهر، الأقسام، النتائج) |
| `/import` | استيراد الموظفين من CSV/Excel مع كشف التكرار |
| `/activity` | سجل النشاط (للمدير/المشرف) |
| `/notifications`, `/settings` | الإشعارات والإعدادات |

### قواعد النقاط (Scoring)

- نتيجة إيجابية (+1): تم التسجيل، تعاون، قبل التدريب، أكمل الخطوات.
- نتيجة سلبية (−1): رفض، قال مشغول ورفض تحديد وقت، أجّل مرارًا، رفض المساعدة، غادر دون إكمال.
- محايدة (0): انشغال طبي، حالة طارئة، مشكلة نظام، تأخير إداري… إلخ.
- عندما يصل **صافي النقاط إلى −3 أو أقل** يُفتح تصعيد تلقائيًا ويصل إشعار للمدير/المشرفين.
- القواعد معرّفة في مكان واحد: `src/lib/evaluation.ts` (ويُطبقها الخادم في دالة `submit_evaluation` داخل `0002_integration.sql`، فلا يمكن تزوير النقاط من المتصفح).

## وضعان للتشغيل (Two modes)

1. **Demo** (الافتراضي عند عدم ضبط Supabase): كل البيانات في `localStorage` للمتصفح الحالي فقط، ولا تُشارَك مع أجهزة أخرى. مناسب للتجربة.
   الدخول من `/login` بحساب الديمو (يمكن تغييره بـ `NEXT_PUBLIC_DEMO_USER` / `NEXT_PUBLIC_DEMO_PASSWORD`).
2. **Live** (Supabase): قاعدة بيانات مشتركة + Supabase Auth + صلاحيات (RLS). هذا هو الوضع المطلوب للاستخدام الفعلي من عدة أجهزة.

## التشغيل (Setup)

```bash
npm install
cp .env.example .env.local      # املأ بيانات Supabase للوضع الفعلي
npm run dev
```

### إعداد Supabase

1. أنشئ مشروعًا، وفي **SQL Editor** شغّل بهذا الترتيب:
   1. `supabase/migrations/0001_init.sql`
   2. `supabase/migrations/0002_integration.sql`  ← **جديد ومهم** (دوال النموذج + إصلاحات أمنية)
   3. `supabase/seed.sql` (الأقسام)
   4. `supabase/seed_staff.sql` (قائمة الموظفين)
2. أنشئ مستخدمًا من **Authentication → Users**، ثم اجعله مديرًا:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   الأدوار: `admin` (كل شيء) · `supervisor` (تعديل واعتماد تصعيدات واستيراد) · `team_member` (عرض وإضافة موظف).
3. ضع `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY` في `.env.local` (وفي Vercel).

### أوامر

```bash
npm run dev        # تطوير
npm run build      # بناء
npm run typecheck  # فحص الأنواع
npm run lint
```

## بنية الكود

```
src/lib/evaluation.ts   قواعد التقييم والنقاط (مصدر واحد) + دوال بحث عربي ورقم الهاتف
src/lib/repo/           طبقة بيانات واحدة بواجهة واحدة: demo.ts (localStorage) و live.ts (Supabase)
src/lib/i18n.ts         كل النصوص (عربي/إنجليزي)
src/components/         layout (القائمة/الشريط/الحماية) + shared + ui
supabase/migrations/    0001 الجداول  ·  0002 الدوال والصلاحيات
```

كل الصفحات تقرأ وتكتب عبر `getRepo()` فقط، فما يُدخل في النموذج يظهر فورًا في الداشبورد وملف الموظف والمتابعات والتصعيدات والتحليلات.

## الأمان

- لا تضع `service_role` key في المتصفح أو في هذا المشروع.
- نموذج التقييم العام لا يملك صلاحية مباشرة على الجداول؛ يعمل فقط عبر دوال SQL محدودة (`search_staff`, `add_staff_public`, `submit_evaluation`, `public_stats`).
- سجل النشاط للإضافة فقط (لا تعديل ولا حذف)، وتصفير النقاط يحتفظ بالسجل.
- أعمدة كلمات المرور وPIN والرقم القومي والهاتف والراتب لا تُقرأ ولا تُحفظ عند الاستيراد.
- بيانات الديمو داخل المتصفح غير محمية؛ لا تضع بيانات حقيقية في وضع Demo على موقع عام.
