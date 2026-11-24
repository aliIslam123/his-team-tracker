-- HIS Team Tracker — 0006: permissions single source + member record scoping + comparison dashboard.
-- Run AFTER 0005_hospitals.sql. Safe to re-run (idempotent).
--
-- Design:
--  * Permission keys live in ONE place: src/lib/permissions.ts (UI) and public.has_permission()
--    (database). The two lists must stay identical; both default by role and both honour the
--    per-user overrides in profiles.permissions ({"staff.manage": false, ...}).
--  * hospital_admin / super_admin-only screens are forced keys: hospitals.manage and
--    comparison.view can never be granted to a lower role by a JSON override.
--  * A member now sees ONLY the evaluations he recorded (interactions.recorded_by) plus the
--    evaluations of staff members assigned to him (staff_members.assigned_to).
--  * Sensitive policies additionally require the matching permission, so a supervisor whose
--    admin turned a permission off loses the ability in the database too — not just the UI.
--  * compare_hospitals() feeds the super_admin comparison dashboard (per-hospital aggregates).

-- ---------------------------------------------------------------------------
-- 1) staff assignment: the member responsible for a staff member
-- ---------------------------------------------------------------------------
alter table public.staff_members add column if not exists assigned_to uuid references public.profiles(id);

create index if not exists staff_members_assigned_idx on public.staff_members (assigned_to)
  where assigned_to is not null;

-- An assignee must be an active 'member' profile of the SAME hospital (service role included).
create or replace function public.validate_staff_assignee() returns trigger as $$
declare
  v_user public.profiles%rowtype;
begin
  if TG_OP = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  if new.assigned_to is null then return new; end if;

  select * into v_user from public.profiles where id = new.assigned_to;
  if not found then raise exception 'user_not_found'; end if;
  if not coalesce(v_user.is_active, true) then raise exception 'not_allowed'; end if;
  if v_user.hospital_id is null or v_user.hospital_id <> new.hospital_id then
    raise exception 'invalid_hospital';
  end if;
  if v_user.role <> 'member' then raise exception 'not_allowed'; end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists staff_assignee_check on public.staff_members;
create trigger staff_assignee_check before insert or update on public.staff_members
  for each row execute function public.validate_staff_assignee();

-- ---------------------------------------------------------------------------
-- 2) has_permission(): role defaults + profiles.permissions overrides (ONE place in SQL)
-- ---------------------------------------------------------------------------
-- Keys (keep in sync with src/lib/permissions.ts):
--   staff.manage · staff.import · staff.assign · users.manage · hospitals.manage
--   activity.view · escalations.review · followups.manage · analytics.view
--   comparison.view · beds.manage · beds.assigned
create or replace function public.has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           nullif(u.permissions ->> p_permission, '')::boolean,
           case u.role
             when 'super_admin'    then true
             when 'hospital_admin' then p_permission in (
               'staff.manage','staff.import','staff.assign','users.manage',
               'activity.view','escalations.review','followups.manage','analytics.view','beds.manage')
             when 'supervisor'     then p_permission in (
               'staff.manage','staff.import','activity.view',
               'escalations.review','followups.manage','analytics.view','beds.manage')
             when 'member'         then p_permission in ('analytics.view','beds.assigned')
             else false
           end
         ) = true
    from public.profiles u
   where u.id = p_user_id;
$$;

-- Authenticated-user flavour used inside RLS policies.
-- 'hospitals.manage' and 'comparison.view' are forced super_admin keys: a JSON override
-- can never hand them to a lower role.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
           when p_permission in ('hospitals.manage','comparison.view') then public.is_super_admin()
           else public.has_permission(auth.uid(), p_permission)
         end;
$$;

-- ---------------------------------------------------------------------------
-- 3) RLS updates: member record scoping + permission checks inside the policies
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('staff_members','interactions','follow_ups','escalation_drafts',
                         'escalation_reviews','audit_logs','import_jobs','import_rows')
       and policyname in ('staff_insert','staff_update','staff_delete_admin',
                          'interactions_select','fu_update','esc_update_supervisor',
                          'er_insert_supervisor','audit_select',
                          'import_jobs_select','import_jobs_insert','import_jobs_update',
                          'import_rows_select','import_rows_insert')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- staff_members: manage (create/edit/delete) additionally needs the staff.manage permission
create policy "staff_insert" on public.staff_members for insert
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.manage'))));

create policy "staff_update" on public.staff_members for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.manage'))))
  with check (auth.uid() is not null and (public.is_super_admin() or hospital_id = public.app_hospital_id()));

create policy "staff_delete_admin" on public.staff_members for delete
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() = 'hospital_admin'
        and public.has_permission('staff.manage'))));

-- interactions: a member sees ONLY what he recorded + evaluations of his assigned staff;
-- every other role keeps seeing its whole hospital.
create policy "interactions_select" on public.interactions for select
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and (public.app_role() <> 'member'
             or recorded_by = auth.uid()
             or exists (select 1 from public.staff_members s
                         where s.id = staff_member_id and s.assigned_to = auth.uid())))));

-- follow_ups: admins/supervisors manage them; a member may only update follow-ups assigned to him
create policy "fu_update" on public.follow_ups for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('followups.manage'))
    or (hospital_id = public.app_hospital_id() and assigned_to = auth.uid())))
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('followups.manage'))
    or (hospital_id = public.app_hospital_id() and assigned_to = auth.uid())));

-- escalation review needs the escalations.review permission
create policy "esc_update_supervisor" on public.escalation_drafts for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('escalations.review'))))
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('escalations.review'))));

create policy "er_insert_supervisor" on public.escalation_reviews for insert
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('escalations.review'))));

-- activity log readers need activity.view
create policy "audit_select" on public.audit_logs for select
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('activity.view'))));

-- staff import needs the staff.import permission
create policy "import_jobs_select" on public.import_jobs for select
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.import'))));

create policy "import_jobs_insert" on public.import_jobs for insert
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.import'))));

create policy "import_jobs_update" on public.import_jobs for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.import'))));

create policy "import_rows_select" on public.import_rows for select
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.import'))));

create policy "import_rows_insert" on public.import_rows for insert
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.import'))));

-- ---------------------------------------------------------------------------
-- 4) comparison dashboard RPC (super_admin only)
-- ---------------------------------------------------------------------------
create or replace function public.compare_hospitals()
returns table (
  hospital_id uuid, hospital_name text, hospital_slug text, hospital_active boolean,
  staff_total bigint, staff_registered bigint, staff_pending bigint,
  evaluations_total bigint, evaluations_7d bigint,
  followups_open bigint, followups_overdue bigint, escalations_pending bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'not_allowed'; end if;
  return query
    select h.id, h.name, h.slug, h.is_active,
      (select count(*) from public.staff_members s
        where s.hospital_id = h.id and s.is_active),
      (select count(*) from public.staff_members s
        where s.hospital_id = h.id and s.is_active and s.registration_status = 'registered'),
      (select count(*) from public.staff_members s
        where s.hospital_id = h.id and s.is_active and s.registration_status <> 'registered'),
      (select count(*) from public.interactions i
        where i.hospital_id = h.id and i.interaction_type = 'evaluation'),
      (select count(*) from public.interactions i
        where i.hospital_id = h.id and i.interaction_type = 'evaluation'
          and i.created_at > now() - interval '7 days'),
      (select count(*) from public.follow_ups f
        where f.hospital_id = h.id and f.status not in ('completed','cancelled')),
      (select count(*) from public.follow_ups f
        where f.hospital_id = h.id and f.status not in ('completed','cancelled')
          and f.due_date < current_date),
      (select count(*) from public.escalation_drafts e
        where e.hospital_id = h.id and e.status in ('draft','pending_review','returned'))
    from public.hospitals h
    order by h.name;
end;
$$;

revoke all on function public.compare_hospitals() from public, anon;
grant execute on function public.compare_hospitals() to authenticated;
