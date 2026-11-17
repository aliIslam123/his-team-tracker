-- HIS Team Tracker — 0005: multi-hospital + admin-managed accounts + hospital-scoped RLS.
-- Run AFTER 0001_init.sql, 0002_integration.sql, 0003_clear_evaluations.sql and 0004_bed_followups.sql.
-- Safe to re-run (idempotent).
--
-- Design:
--  * public.hospitals (name, slug, is_active) — the existing single-hospital data is migrated into
--    the first row "عين شمس" (slug: ain-shams).
--  * Every data table gets hospital_id. Members can only ever touch rows of their own hospital,
--    enforced here by RLS (not just the UI).
--  * Roles become: super_admin (all hospitals, hospital_id NULL) · hospital_admin · supervisor · member.
--    The old 'admin' role maps to super_admin, 'team_member' maps to 'member'.
--  * Accounts are created ONLY by an admin through the service-role API (Route Handler).
--    There is deliberately no INSERT policy on profiles, so self-signup cannot create one.
--  * The old anon functions (search_staff, add_staff_public, submit_evaluation, public_stats) are
--    revoked; new slug-scoped variants (*_h) serve the public form at /h/<slug>/.

-- ---------------------------------------------------------------------------
-- 1) hospitals
-- ---------------------------------------------------------------------------
create table if not exists public.hospitals (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hospitals drop constraint if exists hospitals_slug_check;
alter table public.hospitals add constraint hospitals_slug_check
  check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$');

-- The existing (single-hospital) data lives here from now on.
insert into public.hospitals (name, slug, is_active)
values ('عين شمس', 'ain-shams', true)
on conflict (slug) do nothing;

drop trigger if exists hospitals_touch on public.hospitals;
create trigger hospitals_touch before update on public.hospitals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) profiles: username, hospital, permissions, forced password change
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists hospital_id uuid references public.hospitals(id) on delete set null;
alter table public.profiles add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists job_title text;

alter table public.profiles drop constraint if exists profiles_role_check;
-- migrate old role names BEFORE re-adding the check
update public.profiles set role = 'super_admin' where role = 'admin';
update public.profiles set role = 'member' where role = 'team_member';
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin','hospital_admin','supervisor','member'));

alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index if not exists profiles_username_unique on public.profiles (lower(username)) where username is not null;

-- every pre-existing non-super account belongs to the first hospital
update public.profiles p
   set hospital_id = h.id
  from public.hospitals h
 where h.slug = 'ain-shams'
   and p.hospital_id is null
   and p.role <> 'super_admin';

-- ---------------------------------------------------------------------------
-- 3) hospital_id on every data table (+ backfill + index)
-- ---------------------------------------------------------------------------
alter table public.staff_members      add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.interactions       add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.interaction_support add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.follow_ups         add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.escalation_drafts  add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.escalation_reviews add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.notifications      add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.audit_logs         add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.import_jobs        add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.import_rows        add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;
alter table public.bed_followups      add column if not exists hospital_id uuid references public.hospitals(id) on delete cascade;

do $$
declare
  v_first uuid;
begin
  select id into v_first from public.hospitals where slug = 'ain-shams';

  update public.staff_members       set hospital_id = v_first where hospital_id is null;
  update public.interactions i      set hospital_id = s.hospital_id
    from public.staff_members s where i.staff_member_id = s.id and i.hospital_id is null;
  update public.interaction_support is set hospital_id = i.hospital_id
    from public.interactions i where is.interaction_id = i.id and is.hospital_id is null;
  update public.follow_ups f        set hospital_id = s.hospital_id
    from public.staff_members s where f.staff_member_id = s.id and f.hospital_id is null;
  update public.escalation_drafts e set hospital_id = s.hospital_id
    from public.staff_members s where e.staff_member_id = s.id and e.hospital_id is null;
  update public.escalation_reviews r set hospital_id = d.hospital_id
    from public.escalation_drafts d where r.escalation_draft_id = d.id and r.hospital_id is null;
  update public.notifications n     set hospital_id = p.hospital_id
    from public.profiles p where n.recipient_id = p.id and n.hospital_id is null;
  update public.audit_logs          set hospital_id = v_first where hospital_id is null;
  update public.import_jobs j       set hospital_id = coalesce(p.hospital_id, v_first)
    from public.profiles p where j.created_by = p.id and j.hospital_id is null;
  update public.import_rows r       set hospital_id = j.hospital_id
    from public.import_jobs j where r.import_job_id = j.id and r.hospital_id is null;
  update public.bed_followups       set hospital_id = v_first where hospital_id is null;
end $$;

create index if not exists staff_members_hospital_idx      on public.staff_members (hospital_id);
create index if not exists interactions_hospital_idx       on public.interactions (hospital_id, created_at desc);
create index if not exists interaction_support_hospital_idx on public.interaction_support (hospital_id);
create index if not exists follow_ups_hospital_idx         on public.follow_ups (hospital_id);
create index if not exists escalation_drafts_hospital_idx  on public.escalation_drafts (hospital_id);
create index if not exists escalation_reviews_hospital_idx on public.escalation_reviews (hospital_id);
create index if not exists notifications_hospital_idx      on public.notifications (hospital_id);
create index if not exists audit_logs_hospital_idx         on public.audit_logs (hospital_id, created_at desc);
create index if not exists import_jobs_hospital_idx        on public.import_jobs (hospital_id);
create index if not exists import_rows_hospital_idx        on public.import_rows (hospital_id);
create index if not exists bed_followups_hospital_idx      on public.bed_followups (hospital_id);

-- ---------------------------------------------------------------------------
-- 4) helpers
-- ---------------------------------------------------------------------------
create or replace function public.app_hospital_id() returns uuid
language sql stable security definer set search_path = public as $$
  select hospital_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), '') = 'super_admin';
$$;

-- hospital of a public-form slug; NULL when the slug is unknown or the hospital is off
create or replace function public.hospital_for_slug(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.hospitals
   where slug = lower(trim(coalesce(p_slug, ''))) and is_active;
$$;

-- ---------------------------------------------------------------------------
-- 5) profile trigger: created by the service-role API only
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role, username, hospital_id, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when new.raw_user_meta_data->>'role' in ('super_admin','hospital_admin','supervisor','member')
         then new.raw_user_meta_data->>'role' else 'member' end,
    nullif(trim(coalesce(new.raw_user_meta_data->>'username', '')), ''),
    case when coalesce(new.raw_user_meta_data->>'hospital_id', '') ~ '^[0-9a-fA-F-]{36}$'
         then (new.raw_user_meta_data->>'hospital_id')::uuid else null end,
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nobody (except super_admin / service role) may change role, hospital, username,
-- permissions or active flag from the client — this is the DB half of "المستخدم
-- مايقدرش يغيّر دوره أو مستشفاه أو صلاحياته بنفسه".
create or replace function public.protect_profile_columns() returns trigger as $$
declare
  v_actor_role text;
begin
  if auth.uid() is null then return new; end if; -- service role / SQL editor
  select role into v_actor_role from public.profiles where id = auth.uid();
  if v_actor_role = 'super_admin' then return new; end if;

  if new.role is distinct from old.role
     or new.hospital_id is distinct from old.hospital_id
     or new.permissions is distinct from old.permissions
     or new.username is distinct from old.username
     or new.is_active is distinct from old.is_active
     or new.job_title is distinct from old.job_title then
    raise exception 'protected_column';
  end if;

  -- must_change_password may only be CLEARED (true -> false) by the user, after a real password change
  if new.must_change_password is distinct from old.must_change_password
     and not (coalesce(old.must_change_password, false) and not coalesce(new.must_change_password, false)) then
    raise exception 'protected_column';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- 6) RLS: drop every existing policy on the managed tables, then recreate scoped
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('hospitals','profiles','departments','staff_members','interactions',
                         'interaction_support','follow_ups','escalation_drafts','escalation_reviews',
                         'notifications','audit_logs','import_jobs','import_rows','scoring_rules','bed_followups')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.hospitals enable row level security;

-- hospitals: a member reads ONLY their own hospital row; super_admin sees/edits everything
create policy "hospitals_select" on public.hospitals for select
  using (auth.uid() is not null and (public.is_super_admin() or id = public.app_hospital_id()));
create policy "hospitals_super_admin_all" on public.hospitals for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles: see yourself + your hospital's colleagues (names); super_admin sees all.
-- NO insert policy on purpose: accounts are created via the service-role API only.
create policy "profiles_select" on public.profiles for select
  using (auth.uid() = id or public.is_super_admin()
         or (hospital_id is not null and hospital_id = public.app_hospital_id()));
create policy "profiles_update_self" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id and role = public.app_role());
create policy "profiles_super_admin_all" on public.profiles for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- departments stay global (generic, non-sensitive labels)
create policy "departments_select" on public.departments for select using (auth.uid() is not null);
create policy "departments_admin_write" on public.departments for all
  using (public.app_role() in ('super_admin','hospital_admin'))
  with check (public.app_role() in ('super_admin','hospital_admin'));

-- staff_members (قائمة الأسماء) — per hospital
create policy "staff_select" on public.staff_members for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "staff_insert" on public.staff_members for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "staff_update" on public.staff_members for update
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "staff_delete_admin" on public.staff_members for delete
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() = 'hospital_admin')));

-- interactions (التقييمات) — per hospital
create policy "interactions_select" on public.interactions for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "interactions_insert" on public.interactions for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "interactions_update" on public.interactions for update
  using (auth.uid() is not null and (recorded_by = auth.uid() or public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));

create policy "is_select" on public.interaction_support for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "is_insert" on public.interaction_support for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));

-- follow_ups — per hospital
create policy "fu_select" on public.follow_ups for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "fu_insert" on public.follow_ups for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "fu_update" on public.follow_ups for update
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));

-- escalation_drafts — per hospital; review is supervisor+
create policy "esc_select" on public.escalation_drafts for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "esc_insert" on public.escalation_drafts for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "esc_update_supervisor" on public.escalation_drafts for update
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));

create policy "er_select" on public.escalation_reviews for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "er_insert_supervisor" on public.escalation_reviews for insert
  with check (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));

-- notifications: private to the recipient
create policy "notif_select" on public.notifications for select using (recipient_id = auth.uid());
create policy "notif_update" on public.notifications for update using (recipient_id = auth.uid());
create policy "notif_insert" on public.notifications for insert with check (auth.uid() is not null);

-- audit_logs: append-only; supervisors+ read their hospital's log
create policy "audit_insert" on public.audit_logs for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id() or hospital_id is null));
create policy "audit_select" on public.audit_logs for select
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));

-- import jobs — supervisor+ of the hospital
create policy "import_jobs_select" on public.import_jobs for select
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));
create policy "import_jobs_insert" on public.import_jobs for insert
  with check (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));
create policy "import_jobs_update" on public.import_jobs for update
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));
create policy "import_rows_select" on public.import_rows for select
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));
create policy "import_rows_insert" on public.import_rows for insert
  with check (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));

create policy "sr_select" on public.scoring_rules for select using (auth.uid() is not null);
create policy "sr_admin" on public.scoring_rules for all
  using (public.app_role() in ('super_admin','hospital_admin'))
  with check (public.app_role() in ('super_admin','hospital_admin'));

-- bed_followups — per hospital (ownership enforcement arrives in migration 0007)
create policy "bed_select" on public.bed_followups for select
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "bed_insert" on public.bed_followups for insert
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "bed_update" on public.bed_followups for update
  using (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
create policy "bed_delete" on public.bed_followups for delete
  using (auth.uid() is not null and (public.is_super_admin()
         or (hospital_id = public.app_hospital_id() and public.app_role() in ('hospital_admin','supervisor'))));

-- ---------------------------------------------------------------------------
-- 7) server-side evaluation logic: keep, but scope to the caller's hospital
-- ---------------------------------------------------------------------------
create or replace function public.reset_staff_score(p_staff_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev int;
begin
  if not exists (
    select 1
      from public.staff_members s
      join public.profiles p on p.id = auth.uid()
     where s.id = p_staff_id
       and (p.role = 'super_admin'
            or (s.hospital_id = p.hospital_id and p.role in ('hospital_admin','supervisor')))
  ) then raise exception 'not_allowed'; end if;

  select manual_score into v_prev from public.staff_members where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found'; end if;

  update public.staff_members set manual_score = 0 where id = p_staff_id;
  insert into public.audit_logs (actor_id, hospital_id, action, entity_type, entity_id, previous_values, new_values, reason)
  select auth.uid(), s.hospital_id, 'score_reset', 'staff_member', p_staff_id,
         jsonb_build_object('manual_score', v_prev), jsonb_build_object('manual_score', 0), p_reason
    from public.staff_members s where s.id = p_staff_id;
end;
$$;

create or replace function public.clear_staff_evaluations(p_staff_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev int;
begin
  if not exists (
    select 1
      from public.staff_members s
      join public.profiles p on p.id = auth.uid()
     where s.id = p_staff_id
       and (p.role = 'super_admin'
            or (s.hospital_id = p.hospital_id and p.role in ('hospital_admin','supervisor')))
  ) then raise exception 'not_allowed'; end if;

  select manual_score into v_prev from public.staff_members where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found'; end if;

  delete from public.interactions
   where staff_member_id = p_staff_id
     and interaction_type = 'evaluation';

  update public.staff_members set manual_score = 0 where id = p_staff_id;

  insert into public.audit_logs (actor_id, hospital_id, action, entity_type, entity_id, previous_values, new_values, reason)
  select auth.uid(), s.hospital_id, 'evaluations_cleared', 'staff_member', p_staff_id,
         jsonb_build_object('manual_score', v_prev), jsonb_build_object('manual_score', 0), p_reason
    from public.staff_members s where s.id = p_staff_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) public form: old anon functions are closed, new slug-scoped ones open
-- ---------------------------------------------------------------------------
revoke all on function public.search_staff(text) from public, anon, authenticated;
revoke all on function public.add_staff_public(text, text, text) from public, anon, authenticated;
revoke all on function public.public_stats() from public, anon, authenticated;
revoke all on function public.submit_evaluation(uuid, text, text, text, text, date, text) from public, anon, authenticated;
revoke all on function public.reset_staff_score(uuid, text) from public;
revoke all on function public.clear_staff_evaluations(uuid, text) from public;
revoke all on function public.patch_bed_tasks(uuid, jsonb) from public;

grant execute on function public.reset_staff_score(uuid, text) to authenticated;
grant execute on function public.clear_staff_evaluations(uuid, text) to authenticated;
grant execute on function public.patch_bed_tasks(uuid, jsonb) to authenticated;

-- Search the staff directory of ONE hospital by its public slug (max 10 rows, safe fields only).
create or replace function public.search_staff_h(p_slug text, p_query text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r), '[]'::json) from (
    select s.id, s.full_name, s.job_type, s.his_user_id
      from public.staff_members s
     where s.hospital_id = public.hospital_for_slug(p_slug)
       and s.is_active
       and length(trim(coalesce(p_query, ''))) >= 2
       and (
         translate(lower(s.full_name), 'أإآىةؤئ', 'ااايهوي')
           like '%' || translate(lower(replace(replace(trim(p_query), '%', ''), '_', '')), 'أإآىةؤئ', 'ااايهوي') || '%'
         or coalesce(s.his_user_id, '') ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '') || '%'
       )
     order by s.full_name
     limit 10
  ) r;
$$;

-- Aggregate counts only, for one hospital's public form summary block.
create or replace function public.public_stats_h(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total',      count(*) filter (where is_active),
    'registered', count(*) filter (where is_active and registration_status = 'registered'),
    'pending',    count(*) filter (where is_active and registration_status <> 'registered'),
    'review',     count(*) filter (where is_active and manual_score <= -3)
  ) from public.staff_members
   where hospital_id = public.hospital_for_slug(p_slug);
$$;

-- Add a person from the public form (flagged needs_review so an admin can verify).
create or replace function public.add_staff_public_h(
  p_slug text, p_full_name text, p_job_type text, p_his_user_id text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_hospital uuid := public.hospital_for_slug(p_slug);
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_his text := nullif(trim(coalesce(p_his_user_id, '')), '');
  v_row public.staff_members%rowtype;
begin
  if v_hospital is null then raise exception 'invalid_hospital'; end if;
  if length(v_name) < 3 then raise exception 'invalid_name'; end if;
  if p_job_type not in ('Doctor','Specialist Doctor','Head Nurse','Nurse','Administration') then
    raise exception 'invalid_job_type';
  end if;

  select * into v_row from public.staff_members
   where hospital_id = v_hospital
     and ((v_his is not null and his_user_id = v_his)
          or translate(lower(full_name), 'أإآىةؤئ', 'ااايهوي') = translate(lower(v_name), 'أإآىةؤئ', 'ااايهوي'))
   limit 1;

  if not found then
    insert into public.staff_members (hospital_id, full_name, job_type, his_user_id, is_active, registration_status, needs_review)
    values (v_hospital, v_name, p_job_type, v_his, true, 'not_started', true)
    returning * into v_row;

    insert into public.audit_logs (actor_id, hospital_id, action, entity_type, entity_id, new_values)
    values (auth.uid(), v_hospital, 'staff_added_from_form', 'staff_member', v_row.id, jsonb_build_object('full_name', v_name));
  end if;

  return json_build_object('id', v_row.id, 'full_name', v_row.full_name, 'job_type', v_row.job_type, 'his_user_id', v_row.his_user_id);
end;
$$;

-- The evaluation itself for ONE hospital: points are computed HERE (never in the browser),
-- registration status / follow-up / audit / escalation / notifications all scoped to that hospital.
create or replace function public.submit_evaluation_h(
  p_slug text, p_staff_id uuid, p_reporter_name text, p_reporter_phone text,
  p_result text, p_notes text default null,
  p_followup_date date default null, p_followup_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_hospital uuid := public.hospital_for_slug(p_slug);
  v_phone text := regexp_replace(coalesce(p_reporter_phone, ''), '\s', '', 'g');
  v_name text := trim(coalesce(p_reporter_name, ''));
  v_points int;
  v_staff public.staff_members%rowtype;
  v_score int;
  v_eval_id uuid;
  v_escalated boolean := false;
  v_esc_id uuid;
begin
  if v_hospital is null then raise exception 'invalid_hospital'; end if;
  if length(v_name) < 2 then raise exception 'invalid_reporter_name'; end if;
  if v_phone !~ '^01[0125][0-9]{8}$' then raise exception 'invalid_phone'; end if;

  v_points := case
    when p_result in ('registered','cooperated','accepted_training','completed_steps') then 1
    when p_result in ('refused','busy_refused','postponed','refused_assistance','left_incomplete') then -1
    when p_result in ('busy_medical','emergency','not_available','system_problem','requested_appointment','admin_delay','other') then 0
    else null end;
  if v_points is null then raise exception 'invalid_result'; end if;

  select * into v_staff from public.staff_members
   where id = p_staff_id and hospital_id = v_hospital and is_active for update;
  if not found then raise exception 'staff_not_found'; end if;

  insert into public.interactions (
    hospital_id, staff_member_id, reporter_name, reporter_phone, recorded_by, interaction_type,
    outcome, notes, followup_scheduled, eligible_points
  ) values (
    v_hospital, p_staff_id, v_name, v_phone, auth.uid(), 'evaluation',
    p_result, nullif(trim(coalesce(p_notes, '')), ''), p_followup_date is not null, v_points
  ) returning id into v_eval_id;

  update public.staff_members set
    manual_score = manual_score + v_points,
    registration_status = case
      when p_result = 'registered' then 'registered'
      when registration_status = 'registered' then 'registered'
      when p_followup_date is not null then 'needs_followup'
      when registration_status = 'not_started' then 'pending'
      else registration_status end
  where id = p_staff_id
  returning manual_score into v_score;

  if p_followup_date is not null then
    insert into public.follow_ups (hospital_id, staff_member_id, interaction_id, due_date, notes, priority, status, created_by)
    values (v_hospital, p_staff_id, v_eval_id, p_followup_date, nullif(trim(coalesce(p_followup_note, '')), ''), 'medium', 'scheduled', auth.uid());
  end if;

  insert into public.audit_logs (actor_id, hospital_id, action, entity_type, entity_id, new_values)
  values (auth.uid(), v_hospital, 'evaluation', 'staff_member', p_staff_id,
          jsonb_build_object('result', p_result, 'points', v_points, 'evaluator', v_name,
                             'notes', nullif(trim(coalesce(p_notes, '')), '')));

  if v_score <= -3 and not exists (
    select 1 from public.escalation_drafts
     where staff_member_id = p_staff_id and status in ('draft', 'pending_review', 'returned')
  ) then
    insert into public.escalation_drafts (hospital_id, staff_member_id, total_points, status, draft_text)
    values (v_hospital, p_staff_id, v_score, 'pending_review', '')
    returning id into v_esc_id;
    v_escalated := true;

    insert into public.notifications (hospital_id, recipient_id, title, body, type, link)
    select v_hospital, p.id, 'Escalation needs review / تصعيد بانتظار المراجعة',
           v_staff.full_name || ' (' || v_score || ')', 'escalation', '/escalations/' || v_esc_id
      from public.profiles p
     where p.is_active
       and (p.role = 'super_admin' or (p.hospital_id = v_hospital and p.role in ('hospital_admin','supervisor')));
  end if;

  return json_build_object('points', v_points, 'new_score', v_score, 'escalated', v_escalated);
end;
$$;

revoke all on function public.search_staff_h(text, text) from public;
revoke all on function public.public_stats_h(text) from public;
revoke all on function public.add_staff_public_h(text, text, text, text) from public;
revoke all on function public.submit_evaluation_h(text, uuid, text, text, text, text, date, text) from public;

grant execute on function public.search_staff_h(text, text) to anon, authenticated;
grant execute on function public.public_stats_h(text) to anon, authenticated;
grant execute on function public.add_staff_public_h(text, text, text, text) to anon, authenticated;
grant execute on function public.submit_evaluation_h(text, uuid, text, text, text, text, date, text) to anon, authenticated;
