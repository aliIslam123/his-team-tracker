-- Holool His — 0013: enforce staff.assign, fix member follow-ups, and scope member reads.
-- Run AFTER 0012_comparison_patients.sql. Safe to re-run (idempotent).

-- 1) staff.assign: changing the responsible engineer requires the permission.
drop policy if exists "staff_update" on public.staff_members;
create policy "staff_update" on public.staff_members for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('staff.manage'))))
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and (old.assigned_to is not distinct from new.assigned_to
             or public.has_permission('staff.assign')))));

-- 2) a member can close follow-ups of staff assigned to him, even when the
--    follow-up itself was created from an evaluation with assigned_to = null.
drop policy if exists "fu_update" on public.follow_ups;
create policy "fu_update" on public.follow_ups for update
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('followups.manage'))
    or (hospital_id = public.app_hospital_id() and public.app_role() = 'member'
        and (assigned_to = auth.uid() or exists (
          select 1 from public.staff_members s
          where s.id = staff_member_id and s.assigned_to = auth.uid())))))
  with check (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id()
        and public.app_role() in ('hospital_admin','supervisor')
        and public.has_permission('followups.manage'))
    or (hospital_id = public.app_hospital_id() and public.app_role() = 'member'
        and (assigned_to = auth.uid() or exists (
          select 1 from public.staff_members s
          where s.id = staff_member_id and s.assigned_to = auth.uid())))));

-- 3) members only see their own follow-ups.
drop policy if exists "fu_select" on public.follow_ups;
create policy "fu_select" on public.follow_ups for select
  using (auth.uid() is not null and (public.is_super_admin()
    or (hospital_id = public.app_hospital_id() and public.app_role() <> 'member')
    or (hospital_id = public.app_hospital_id() and public.app_role() = 'member'
        and (assigned_to = auth.uid() or exists (
          select 1 from public.staff_members s
          where s.id = staff_member_id and s.assigned_to = auth.uid())))));

-- 4) escalation drafts are not visible to members at all.
drop policy if exists "esc_select" on public.escalation_drafts;
create policy "esc_select" on public.escalation_drafts for select
  using (auth.uid() is not null and public.app_role() <> 'member'
    and (public.is_super_admin() or hospital_id = public.app_hospital_id()));
