-- Seed departments
insert into public.departments (name_ar, name_en) values
('الباطنة','Internal Medicine'),
('الجراحة','Surgery'),
('الطوارئ','Emergency'),
('التمريض','Nursing'),
('الإدارة','Administration')
on conflict do nothing;

-- Seed scoring rules
insert into public.scoring_rules (key,label_ar,label_en,points,description_ar,description_en) values
('registered','تم التسجيل بنجاح','Successfully Registered',0,'لا نقاط','No points'),
('clinical_workload','عبء سريري','Genuine clinical workload',0,'لا نقاط','No points'),
('emergency','حالة طارئة','Emergency or patient-care',0,'لا نقاط','No points'),
('technical','مشكلة تقنية','Genuine technical problem',0,'لا نقاط','No points'),
('training','تدريب مطلوب','Training required',0,'لا نقاط','No points'),
('reasonable_postponement','تأجيل معقول','Reasonable postponement',0,'لا نقاط','No points'),
('started_not_completed','بدأ ولم يكتمل','Started but not completed',1,'نقطة واحدة','1 point'),
('repeated_postponement','تأجيل متكرر','Repeated postponement',1,'نقطة واحدة','1 point'),
('repeated_unavailability','عدم توفر متكرر','Repeated unavailability',1,'نقطة واحدة','1 point'),
('avoided_followup','تجنب متابعة','Avoiding scheduled follow-up',2,'نقطتين','2 points'),
('explicit_refusal','رفض صريح','Explicit refusal',3,'3 نقاط','3 points')
on conflict (key) do nothing;
