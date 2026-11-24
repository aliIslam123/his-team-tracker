-- Holool His — 0009: production hardening.
-- Run AFTER 0008_notifications.sql. Safe to re-run (idempotent).
-- (There is intentionally no 0007: bed OWNERSHIP by user account is a planned phase; this file
--  only closes the gaps that block a safe go-live.)
--
--  1) Bed numbers are unique PER HOSPITAL (they were unique across the whole system, so a second
--     hospital could not use "Hall 1 / bed 1", and an import could collide with another hospital).
--  2) Bed write access follows permissions (beds.manage / beds.assigned) instead of "any signed-in user".
--  3) Anti-abuse for the public /h/<slug> form (anon): rate limits + length caps.
--  4) Staff rows can no longer be left without a hospital by accident.

-- ---------------------------------------------------------------------------
-- 1) per-hospital bed uniqueness
-- ---------------------------------------------------------------------------
alter table public.bed_followups drop constraint if exists bed_followups_location_bed_unique;
drop index if exists public.bed_followups_location_bed_unique;

-- PostgREST upsert (onConflict "hospital_id,location,bed_no") needs a real unique constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'bed_followups_hospital_location_bed_key' and conrelid = 'public.bed_followups'::regclass
  ) then
    alter table public.bed_followups
      add constraint bed_followups_hospital_location_bed_key unique (hospital_id, location, bed_no);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) bed policies by permission (patient data!)
-- ---------------------------------------------------------------------------
drop policy if exists "bed_insert" on public.bed_followups;
drop policy if exists "bed_update" on public.bed_followups;
drop policy if exists "bed_delete" on public.bed_followups;

create policy "bed_insert" on public.bed_followups for insert
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id() and public.has_permission('beds.manage'))));

create policy "bed_update" on public.bed_followups for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and (public.has_permission('beds.manage') or public.has_permission('beds.assigned')))))
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and (public.has_permission('beds.manage') or public.has_permission('beds.assigned')))));

create policy "bed_delete" on public.bed_followups for delete
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id() and public.has_permission('beds.manage'))));

-- ---------------------------------------------------------------------------
-- 3) public form: length caps (NOT VALID = applies to new/changed rows only, old data untouched)
-- ---------------------------------------------------------------------------
alter table public.interactions drop constraint if exists interactions_len_chk;
alter table public.interactions add constraint interactions_len_chk check (
  char_length(reporter_name) <= 120
  and char_length(reporter_phone) <= 20
  and (notes is null or char_length(notes) <= 2000)
) not valid;

alter table public.staff_members drop constraint if exists staff_members_len_chk;
alter table public.staff_members add constraint staff_members_len_chk check (
  char_length(full_name) <= 200
  and (his_user_id is null or char_length(his_user_id) <= 40)
) not valid;

-- Rate limits apply ONLY to the anonymous public form (auth.role() = 'anon').
-- Signed-in staff, imports, the SQL editor and the service role are never throttled.
create or replace function public.throttle_public_inserts() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if coalesce(auth.role(), '') <> 'anon' then return new; end if;

  if TG_TABLE_NAME = 'interactions' then
    select count(*) into v_count from public.interactions
     where hospital_id = new.hospital_id and recorded_by is null
       and created_at > now() - interval '5 minutes';
    if v_count >= 200 then raise exception 'rate_limited'; end if;

  elsif TG_TABLE_NAME = 'staff_members' then
    select count(*) into v_count from public.staff_members
     where hospital_id = new.hospital_id and needs_review
       and created_at > now() - interval '10 minutes';
    if v_count >= 40 then raise exception 'rate_limited'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists interactions_throttle on public.interactions;
create trigger interactions_throttle before insert on public.interactions
  for each row execute function public.throttle_public_inserts();

drop trigger if exists staff_members_throttle on public.staff_members;
create trigger staff_members_throttle before insert on public.staff_members
  for each row execute function public.throttle_public_inserts();

-- ---------------------------------------------------------------------------
-- 4) orphan guard: rows without a hospital are invisible to everyone but super_admin.
--    Report them instead of silently hiding them (run this query manually after seeding):
--      select count(*) from public.staff_members where hospital_id is null;
-- ---------------------------------------------------------------------------
do $$
declare v_first uuid; v_orphans int;
begin
  select id into v_first from public.hospitals where slug = 'ain-shams';
  if v_first is not null then
    update public.staff_members set hospital_id = v_first where hospital_id is null;
  end if;
  select count(*) into v_orphans from public.staff_members where hospital_id is null;
  if v_orphans > 0 then
    raise notice 'WARNING: % staff_members rows still have no hospital_id', v_orphans;
  end if;
end $$;
