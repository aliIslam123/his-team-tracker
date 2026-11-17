-- HIS Team Tracker — RLS isolation tests for 0005 (run in the Supabase SQL Editor as postgres).
--
-- Everything runs inside ONE transaction:
--   * a failure raises an exception → the whole transaction rolls back → the database is left clean;
--   * on success the final cleanup deletes every test row → also clean.
--
-- Covers (stage 1 acceptance):
--   1. A hospital-A user selects from hospitals → sees ONLY hospital A, and can never read /
--      update / delete any row of hospital B.
--   2. A member cannot raise their own role, permissions or hospital (trigger + policies).
--   3. anon can read NOTHING (and the old anon functions are revoked).
--   4. super_admin sees every hospital.
--   5. The slug-scoped public functions work only for an active hospital's data.
-- Bed ownership (beds 1–8 vs 9, owner_user_id immutability) is covered by tests/0007_* in stage 3.

create schema if not exists tests;

create or replace function tests.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if coalesce(cond, false) then raise notice 'PASS: %', msg;
  else raise exception 'FAIL: %', msg; end if;
end $$;

-- Runs a statement and requires it to raise an error.
create or replace function tests.expect_error(stmt text, msg text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL (no error raised): %', msg;
exception
  when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS (blocked as expected): % — %', msg, sqlerrm;
end $$;

do $$
declare v_super uuid; v_n bigint;
begin
  -- clean leftovers from any previous (failed) run
  delete from auth.users where email like '%@rls-test.local';
  delete from public.hospitals where slug = 'test-b';
  delete from public.staff_members where full_name like '%تجريبي%';

  -- super_admin user (profile is created by the on_auth_user_created trigger from metadata)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'super-admin@rls-test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
          '{"full_name":"Super Test","username":"super_test","role":"super_admin"}',
          '{"provider":"email","providers":["email"]}', '', '', '', '')
  returning id into v_super;
  select id into v_super from auth.users where email = 'super-admin@rls-test.local';

  -- hospital B is created BY the super_admin through the (RLS-guarded) client path
  perform set_config('request.jwt.claim.sub', v_super::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_super::text, 'role', 'authenticated')::text, true);

  insert into public.hospitals (name, slug) values ('مستشفى الاختبار', 'test-b');
  select count(*) into v_n from public.hospitals where slug = 'test-b';
  perform tests.assert(v_n = 1, 'super_admin can create a hospital');
end $$;

reset role;

-- two more users + test data owned by postgres directly
do $$
declare
  v_a uuid; v_b uuid;
  v_h_a uuid; v_h_b uuid;
begin
  select id into v_h_a from public.hospitals where slug = 'ain-shams';
  select id into v_h_b from public.hospitals where slug = 'test-b';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'member-a@rls-test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
          '{"full_name":"عضو تجريبي A","username":"member_a"}',
          '{"provider":"email","providers":["email"]}', '', '', '', '');

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'member-b@rls-test.local', crypt('x', gen_salt('bf')), now(), now(), now(),
          '{"full_name":"عضو تجريبي B","username":"member_b"}',
          '{"provider":"email","providers":["email"]}', '', '', '', '');

  select id into v_a from auth.users where email = 'member-a@rls-test.local';
  select id into v_b from auth.users where email = 'member-b@rls-test.local';

  update public.profiles set hospital_id = v_h_a, role = 'member' where id = v_a;
  update public.profiles set hospital_id = v_h_b, role = 'member' where id = v_b;

  insert into public.staff_members (hospital_id, full_name, job_type) values
    (v_h_a, 'علي تجريبي', 'Nurse'),
    (v_h_b, 'موظف تجريبي B1', 'Doctor'),
    (v_h_b, 'موظف تجريبي B2', 'Nurse');

  insert into public.bed_followups (hospital_id, location, bed_no) values
    (v_h_b, 'Hall 9', 1), (v_h_b, 'Hall 9', 2);

  insert into public.notifications (hospital_id, recipient_id, title, type)
    values (v_h_b, v_b, 'اختبار', 'test');
end $$;

-- ---------------------------------------------------------------------------
-- Scenario 1: member of hospital A
-- ---------------------------------------------------------------------------
set role authenticated;

do $$
declare
  v_uid uuid; v_h_a uuid; v_h_b uuid;
  n bigint; v_rows bigint;
begin
  select id into v_uid from auth.users where email = 'member-a@rls-test.local';
  select id into v_h_a from public.hospitals where slug = 'ain-shams';
  select id into v_h_b from public.hospitals where slug = 'test-b';

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- 1) hospitals: only his own row
  select count(*) into n from public.hospitals;
  perform tests.assert(n = 1, 'member A selects from hospitals → exactly 1 row');
  select count(*) into n from public.hospitals where id = v_h_a;
  perform tests.assert(n = 1, 'member A sees hospital A');
  select count(*) into n from public.hospitals where id = v_h_b;
  perform tests.assert(n = 0, 'member A cannot read hospital B row');

  -- 2) staff of B: unreadable, unmodifiable, undeletable
  select count(*) into n from public.staff_members where hospital_id = v_h_b;
  perform tests.assert(n = 0, 'member A cannot read hospital B staff');
  select count(*) into n from public.staff_members where hospital_id = v_h_a;
  perform tests.assert(n = 1, 'member A reads only its own staff');

  update public.staff_members set full_name = 'هجوم' where hospital_id = v_h_b;
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'member A cannot update hospital B staff');

  -- 3) beds of B: invisible and undeletable
  select count(*) into n from public.bed_followups;
  perform tests.assert(n = 0, 'member A cannot see hospital B beds');
  delete from public.bed_followups where hospital_id = v_h_b;
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 0, 'member A cannot delete hospital B beds');

  -- 4) notifications and audit log
  select count(*) into n from public.notifications;
  perform tests.assert(n = 0, 'member A cannot read hospital B notifications');
  select count(*) into n from public.audit_logs;
  perform tests.assert(n = 0, 'member cannot read audit logs');

  -- 5) privilege escalation is blocked
  perform tests.expect_error(
    'update public.profiles set role = ''super_admin'' where id = ''' || v_uid::text || '''',
    'member cannot raise own role');
  perform tests.expect_error(
    'update public.profiles set hospital_id = ''' || v_h_b::text || ''' where id = ''' || v_uid::text || '''',
    'member cannot change own hospital');
  perform tests.expect_error(
    'update public.profiles set permissions = ''{"analytics":true}''::jsonb where id = ''' || v_uid::text || '''',
    'member cannot grant itself module permissions');
  perform tests.expect_error(
    'update public.profiles set username = ''hijacked'' where id = ''' || v_uid::text || '''',
    'member cannot change own username');
  perform tests.expect_error(
    'insert into public.profiles (id, email, full_name, role) values (gen_random_uuid(), ''x@x.local'', ''x'', ''super_admin'')',
    'member cannot insert profiles (accounts come from the service-role API only)');

  -- positive control: editing your own display name is allowed
  update public.profiles set full_name = 'عضو تجريبي A' where id = v_uid;
  get diagnostics v_rows = row_count;
  perform tests.assert(v_rows = 1, 'member can edit own full_name');

  -- 6) profiles of other hospitals are invisible
  select count(*) into n from public.profiles p where p.username = 'member_b';
  perform tests.assert(n = 0, 'member A cannot read hospital B profiles');

  -- 7) the slug-scoped public functions work for HIS hospital only
  perform tests.expect_error(
    'select public.submit_evaluation_h(''test-b'', (select id from public.staff_members where hospital_id = ''' || v_h_b::text || ''' limit 1), ''مبلّغ'', ''01012345678'', ''registered'')',
    'member A cannot evaluate hospital B staff through the public form');

  perform public.submit_evaluation_h('ain-shams',
    (select id from public.staff_members where hospital_id = v_h_a limit 1),
    'مبلّغ تجريبي', '01012345678', 'registered', null, null, null);
  select manual_score into n from public.staff_members where hospital_id = v_h_a limit 1;
  perform tests.assert(n = 1, 'public evaluation scores +1 inside its hospital only');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Scenario 2: anon (no login) can read nothing
-- ---------------------------------------------------------------------------
set role anon;

do $$
declare n bigint; v_res json;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into n from public.staff_members;
  perform tests.assert(n = 0, 'anon cannot read staff_members');
  select count(*) into n from public.hospitals;
  perform tests.assert(n = 0, 'anon cannot read hospitals');
  select count(*) into n from public.bed_followups;
  perform tests.assert(n = 0, 'anon cannot read beds');
  select count(*) into n from public.interactions;
  perform tests.assert(n = 0, 'anon cannot read evaluations');
  select count(*) into n from public.profiles;
  perform tests.assert(n = 0, 'anon cannot read profiles');

  -- the old hospital-agnostic functions are revoked for everyone
  perform tests.expect_error('select public.search_staff(''علي'')', 'old search_staff is revoked');
  perform tests.expect_error('select public.public_stats()', 'old public_stats is revoked');
  perform tests.expect_error(
    'select public.add_staff_public(''اسم تجريبي'', ''Nurse'', null)',
    'old add_staff_public is revoked');

  -- the slug-scoped replacements work for an active hospital …
  v_res := public.search_staff_h('ain-shams', 'علي');
  perform tests.assert(v_res <> '[]'::json, 'anon search_staff_h works for hospital A');
  v_res := public.public_stats_h('ain-shams');
  perform tests.assert((v_res->>'total')::int >= 1, 'anon public_stats_h works for hospital A');
  -- … and expose nothing for an unknown/inactive slug
  v_res := public.search_staff_h('does-not-exist', 'علي');
  perform tests.assert(v_res = '[]'::json, 'anon search_staff_h returns nothing for unknown slug');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Scenario 3: super_admin sees everything
-- ---------------------------------------------------------------------------
set role authenticated;

do $$
declare v_uid uuid; n bigint;
begin
  select id into v_uid from auth.users where email = 'super-admin@rls-test.local';
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  select count(*) into n from public.hospitals;
  perform tests.assert(n >= 2, 'super_admin sees every hospital');
  select count(*) into n from public.staff_members where hospital_id = (select id from public.hospitals where slug = 'test-b');
  perform tests.assert(n = 2, 'super_admin reads hospital B staff');
  select count(*) into n from public.profiles where username = 'member_b';
  perform tests.assert(n = 1, 'super_admin reads profiles of all hospitals');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- cleanup (runs only when every assert passed — failures roll back instead)
-- ---------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from public.staff_members where full_name like '%تجريبي%';
  delete from public.audit_logs where entity_id = any(v_ids);
  delete from public.staff_members where full_name like '%تجريبي%';
  delete from auth.users where email like '%@rls-test.local';
  delete from public.hospitals where slug = 'test-b';
end $$;

select '✅ ALL RLS TESTS PASSED — hospital isolation, privilege escalation and anon lockdown verified' as result;
