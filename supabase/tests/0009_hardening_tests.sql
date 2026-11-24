-- Holool His — tests for 0009_production_hardening.sql.
-- Run in the Supabase SQL Editor as postgres AFTER migrations 0001..0009. Everything runs in ONE
-- transaction that ALWAYS rolls back at the end, so no test data is left behind.
-- Any failed assertion raises an exception and stops the script.

begin;

create schema if not exists tests;
create or replace function tests.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS: %', msg;
  else raise exception 'FAIL: %', msg; end if;
end $$;

-- ---------------------------------------------------------------------------
-- setup: two hospitals, a supervisor + a member in hospital A
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; v_sup uuid; v_mem uuid;
begin
  insert into public.hospitals (name, slug) values ('H9 A', 'h9-a') returning id into v_a;
  insert into public.hospitals (name, slug) values ('H9 B', 'h9-b') returning id into v_b;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     'sup@h9-test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('full_name','Sup Nine','username','sup_h9','role','supervisor','hospital_id',v_a)::text::jsonb,
     '{"provider":"email","providers":["email"]}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     'mem@h9-test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('full_name','Mem Nine','username','mem_h9','role','member','hospital_id',v_a)::text::jsonb,
     '{"provider":"email","providers":["email"]}', '', '', '', '');

  select id into v_sup from auth.users where email = 'sup@h9-test.local';
  select id into v_mem from auth.users where email = 'mem@h9-test.local';
  perform tests.assert((select hospital_id from public.profiles where id = v_sup) = v_a, 'supervisor profile is in hospital A');
  perform tests.assert((select role from public.profiles where id = v_mem) = 'member', 'member profile created');

  -- 1) the same location + bed number can exist in two hospitals (postgres role = migration/seed path)
  insert into public.bed_followups (hospital_id, location, bed_no) values (v_a, 'Hall 1', 1);
  insert into public.bed_followups (hospital_id, location, bed_no) values (v_b, 'Hall 1', 1);
  perform tests.assert((select count(*) from public.bed_followups where location = 'Hall 1' and bed_no = 1) = 2,
                       'same bed number allowed in two different hospitals');

  begin
    insert into public.bed_followups (hospital_id, location, bed_no) values (v_a, 'Hall 1', 1);
    raise exception 'FAIL: duplicate bed inside one hospital was accepted';
  exception when unique_violation then
    raise notice 'PASS: duplicate bed inside one hospital is rejected';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2) bed permissions
-- ---------------------------------------------------------------------------
do $$
declare v_mem uuid; v_sup uuid; v_bed uuid; v_n int;
begin
  select id into v_mem from auth.users where email = 'mem@h9-test.local';
  select id into v_sup from auth.users where email = 'sup@h9-test.local';
  select b.id into v_bed from public.bed_followups b
    join public.hospitals h on h.id = b.hospital_id where h.slug = 'h9-a' and b.location = 'Hall 1';

  -- member: may tick tasks (beds.assigned) but not insert or delete beds
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_mem::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_mem::text, 'role', 'authenticated')::text, true);

  perform public.patch_bed_tasks(v_bed, '{"some_task": true}'::jsonb);
  perform tests.assert((select tasks ->> 'some_task' from public.bed_followups where id = v_bed) = 'true',
                       'member can tick a task on a bed of his hospital');

  begin
    insert into public.bed_followups (hospital_id, location, bed_no) values (public.app_hospital_id(), 'Hall 9', 9);
    raise exception 'FAIL: member inserted a bed';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS: member cannot insert beds';
  end;

  delete from public.bed_followups where id = v_bed;
  get diagnostics v_n = row_count;
  perform tests.assert(v_n = 0, 'member cannot delete beds (0 rows affected)');

  -- member sees only his own hospital's beds
  perform tests.assert((select count(*) from public.bed_followups) = 1, 'member sees only hospital A beds');

  -- supervisor: may insert and delete
  perform set_config('request.jwt.claim.sub', v_sup::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  insert into public.bed_followups (hospital_id, location, bed_no) values (public.app_hospital_id(), 'Hall 9', 9);
  delete from public.bed_followups where location = 'Hall 9';
  get diagnostics v_n = row_count;
  perform tests.assert(v_n = 1, 'supervisor can insert and delete beds');

  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- 3) anon rate limit on the public form (200 evaluations / 5 min / hospital)
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_staff uuid; v_res json; i int; v_blocked boolean := false;
begin
  select id into v_a from public.hospitals where slug = 'h9-a';
  insert into public.staff_members (hospital_id, full_name, job_type, is_active)
    values (v_a, 'Throttle Test Person', 'Nurse', true) returning id into v_staff;

  -- pre-fill 199 anonymous evaluations as postgres (not throttled: auth.role() is not 'anon')
  insert into public.interactions (hospital_id, staff_member_id, reporter_name, reporter_phone, interaction_type, outcome)
    select v_a, v_staff, 'R', '01000000000', 'evaluation', 'other' from generate_series(1, 199);

  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);

  -- the 200th is still allowed, the next one is refused
  v_res := public.submit_evaluation_h('h9-a', v_staff, 'Reporter', '01012345678', 'other');
  begin
    v_res := public.submit_evaluation_h('h9-a', v_staff, 'Reporter', '01012345678', 'other');
  exception when others then
    v_blocked := sqlerrm like '%rate_limited%';
  end;
  reset role;
  perform tests.assert(v_blocked, 'anon evaluation flood is rate limited');
end $$;

-- ---------------------------------------------------------------------------
-- 4) length caps
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_staff uuid;
begin
  select id into v_a from public.hospitals where slug = 'h9-a';
  select id into v_staff from public.staff_members where hospital_id = v_a limit 1;
  begin
    insert into public.interactions (hospital_id, staff_member_id, reporter_name, reporter_phone, interaction_type, outcome, notes)
      values (v_a, v_staff, 'R', '01000000000', 'evaluation', 'other', repeat('x', 2001));
    raise exception 'FAIL: 2001-character note was accepted';
  exception when check_violation then
    raise notice 'PASS: oversized notes are rejected';
  end;
end $$;

select '✅ 0009 TESTS PASSED (rolled back, nothing was saved)' as result;

rollback;
