# ما الذي تغيّر؟ (Changes)

## المرحلة 1 — مستشفيات متعددة + حسابات بلا تسجيل ذاتي (Migration `0005_hospitals.sql`)

- **مستشفيات متعددة**: جدول `hospitals (name, slug, is_active)` وكل بيانات النظام عليها `hospital_id` (الموظفون، التقييمات، المتابعات، التصعيدات، الإشعارات، السجل، الاستيراد، الأسرّة). بيانات المشروع الحالية تُنقل تلقائيًا إلى أول مستشفى «عين شمس» (`slug: ain-shams`)، والأقسام تبقى عامة مشتركة.
- **عزل على مستوى قاعدة البيانات (RLS)**: إعادة كتابة كل السياسات — كل مستخدم يرى مستشفاه فقط (بما فيها صف مستشفاه في جدول `hospitals`), و`anon` لا يرى شيئًا. super_admin يرى الكل ويبدّل بين المستشفيات من الشريط العلوي (فلتر scope من جهة العميل فوق الـ RLS).
- **نموذج عام لكل مستشفى**: النموذج انتقل من `/` إلى `/h/<slug>/`, والدوال القديمة العامة (`search_staff`, `add_staff_public`, `submit_evaluation`, `public_stats`) **أُلغيت** عن `anon` و`authenticated`, وحلّت محلها دوال محدودة بمستشفى الـ slug: `search_staff_h`, `add_staff_public_h`, `submit_evaluation_h`, `public_stats_h`. لا يمكن تقييم موظف عبر مستشفى أخرى حتى لو أعطيت `staff_id` منها.
- **حسابات ينشئها الأدمن فقط**: لا صفحة تسجيل، ولا أي INSERT policy على `profiles`. المهندس يسجل دخول بـ **اسم مستخدم** يُحوَّل داخليًا إلى `username@his.local` في Supabase Auth. الإنشاء/التعديل/الإيقاف/إعادة تعيين كلمة المرور تتم عبر Route Handlers سيرفر-أونلي (`/api/admin/users*`) بمفتاح `SUPABASE_SERVICE_ROLE_KEY` (متغير بيئة سيرفر فقط، لا يظهر في أي bundle). كلمة المرور تُولَّد بـ CSPRNG وتظهر **مرة واحدة** بزر نسخ، مع خيار «إجبار التغيير عند أول دخول» (صفحة `/change-password`), ويمكن للمستخدم تغييرها من الإعدادات.
- **أدوار جديدة**: `super_admin / hospital_admin / supervisor / member` (تحويل تلقائي من `admin/team_member`)، وtrigger يمنع أي مستخدم من تغيير دوره أو مستشفاه أو صلاحياته أو اسم مستخدمه أو حالته بنفسه (`protected_column`).
- **شاشات أدمن**: `/admin/hospitals` (إضافة/تعديل/إيقاف مستشفى + رابط النموذج العام بزر نسخ) و`/admin/users` (إنشاء حساب، تغيير الدور/الاسم/المسمى، إيقاف/تنشيط، إعادة تعيين كلمة مرور) — مع حصر `hospital_admin` في مستشفاه وفي إسناد `supervisor/member` فقط.
- **الديمو لم يُكسر**: المستشفيات والحسابات الوهمية تُحفظ في `localStorage` (نفس مفتاح `his_demo_db_v2` مع حقول اختيارية جديدة)، وحساب الديمو الافتراضي (`teamhis` / `adminhis@@@`) يبقى شغالًا، وكل شاشات الأدمن تعمل في الديمو على بيانات وهمية.
- **اختبارات القبول**: `supabase/tests/0005_rls_tests.sql` — مستشفيان حقيقيان في قاعدة Postgres + سيناريوهات العزل (قراءة/تعديل/حذف عبر الحدود، منع ترقية الدور، حجب `anon`, رؤية super_admin, دوال الـ slug) كلها داخل معاملة واحدة تتراجع بالكامل عند أي فشل.
- التوثيق: `.env.example` (مفتاح الخدمة سيرفر فقط) وREADME (ترتيب الـ migrations، خطوة قفل **Enable Sign-ups** من لوحة Supabase، إنشاء أول super_admin، روابط `/h/<slug>`).

## المرحلة 2 — نظام صلاحيات موحد + إسناد الموظفين + مقارنة المستشفيات (Migration `0006_permissions.sql`)

- **مصدر واحد لكل الصلاحيات**: `src/lib/permissions.ts` في الواجهة، ودالة `public.has_permission()` في `supabase/migrations/0006_permissions.sql` في قاعدة البيانات. القائمتان متطابقتان (يجب الحفاظ على التزامن).
- **إسناد الموظفين**: كل موظف له `assigned_to` (المهندس المسؤول) — يُحدد من شاشة تعديل الموظف (حسابات member فقط، ومن نفس المستشفى). يتم التحقق من أن `assigned_to` هو **عضو نشط** من نفس المستشفى (trigger `validate_staff_assignee`).
- **عزل سجل التقييمات للعضو**: كل عضو يرى فقط التقييمات التي سجّلها هو (`recorded_by`) **+** التقييمات التي سجلها الموظفون المسندون إليه. لا يرى التقييمات التي سجلها موظفون من مستشفيات أخرى.
- **الصلاحيات الإجبارية (super-only)**: `hospitals.manage` و`comparison.view` لا يمكن تفعيلها عبر أي JSON override — فقط `super_admin` يحصل عليها.
- **تعديل الصلاحيات لكل مستخدم**: `/admin/users` يحتوي على لوحة «صلاحيات إضافية» (checkboxes) تُخزن كقائمة `permissions` في `profiles.permissions` وتُفرضها الـ RLS نفسها — لا يمكن للمستخدم تغييرها بنفسه.
- **تعديل الصلاحيات في الخادم**: كل صلاحية تُتحقق داخل السياسات (RLS) و/أو الدوال (rpc) — لا يوجد أي منطق في الـ frontend فقط.
- **دوال RPC جديدة**: `compare_hospitals()` (super_admin فقط) — تُعيد إحصائيات كل مستشفى (عدد الموظفين، التقييمات، المتابعات، التصعيدات) وتُستخدم في لوحة `/admin/comparison`.
- **تعديل الواجهة**: شاشة `/admin/comparison` الجديدة — بطاقات للمستشفيات + جدول كبير + زر «View» لتحديد scope + تنقل إلى `/dashboard`.
- **تعديل الـ repo**: إضافة `compareHospitals()` إلى واجهة `Repo`، وتحديث `live.ts` لاستخدام `assignee:profiles!assigned_to(full_name)` في embeds، وتحديث `demo.ts` لتضمين `recorded_by` في `EvaluationRecord`.
- **تعديل الأنواع**: إضافة `StaffMember.assigned_to`, `assignee` embed، `EvaluationRecord.recorded_by`, و`HospitalComparison` interface.
- **تعديل الـ hooks**: `useRequirePermission` (للحماية من الـ client-side)، و`use-require-role` (للحماية من الـ client-side).
- **تعديل الـ sidebar**: إضافة `/admin/comparison` مع أيقونة `GitCompareArrows` وربطها بـ `comparison.view`.
- **تعديل الـ page guards**: استبدال `useRequireRole` بـ `useRequirePermission` في كل صفحة.
- **تعديل الـ hooks**: `useLoad` و`use-require-permission` لجلب البيانات مع التحقق من الصلاحيات.
- **تعديل الـ i18n**: إضافة جميع الكلمات المفتاحية الجديدة (comparison, evaluations, followups, escalations, assignee, permissions, perm_*).
- **تعديل الـ tests**: إضافة `supabase/tests/0006_permissions_tests.sql` — اختبارات العزل للمستخدمين (super, hospital_admin, supervisor, member)، اختبار `assigned_to` trigger، اختبار `has_permission`, اختبار `compare_hospitals`، اختبارات التبديل بين المستخدمين.
- **تعديل الـ build**: لا أخطاء جديدة في typecheck أو lint (9 أخطاء و 5 تحذيرات في ملفات غير مُعدَّلة).

## المرحلة 3 — (مخطط لها)  
- **مigration `0007`**: تعديل `beds` (owner_user_id → owner_name, patch_bed_tasks)، إضافة `bed_policies`، اختبارات `beds`، صفحة `مهامي`، شاشة `assign-beds`.  
- **Gemini API**: إعداد واجهة مع Gemini API (بعد إكمال المرحلة 3).  

## ما تبقى  
- تشغيل `0005` + `0006` + `0007` على قاعدة Postgres حقيقية.  
- تشغيل اختبارات `supabase/tests/0005_rls_tests.sql` و`0006_permissions_tests.sql` على Postgres.  
- التأكد من أن Demo mode لا يكسر أي شيء (localStorage، `his_demo_db_v2`).  
- لا تغيّر أي `BED_TASKS` keys.  
- التوثيق: `.env.example` + README (ترتيب الـ migrations، خطوة قفل **Enable Sign-ups**، إنشاء super_admin، روابط `/h/<slug>`، `/admin/comparison`).