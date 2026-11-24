-- HIS Team Tracker — 0008: managers can send notifications / messages to their team.
-- Run AFTER 0006_permissions.sql. Safe to re-run (idempotent).
--
-- Permission keys stay in ONE place: src/lib/permissions.ts (UI) and
-- public.has_permission() (database). Keep both lists identical.

create or replace function public.has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           nullif(u.permissions ->> p_permission, '')::boolean,
           case u.role
             when 'super_admin'    then true
             when 'hospital_admin' then p_permission in (
               'staff.manage','staff.import','staff.assign','users.manage',
               'activity.view','escalations.review','followups.manage','analytics.view',
               'beds.manage','notifications.send')
             when 'supervisor'     then p_permission in (
               'staff.manage','staff.import','activity.view',
               'escalations.review','followups.manage','analytics.view',
               'beds.manage','users.manage','notifications.send')
             when 'member'         then p_permission in ('analytics.view','beds.assigned')
             else false
           end
         ) = true
    from public.profiles u
   where u.id = p_user_id;
$$;

-- Only a manager may send a message, and only to somebody in their own hospital.
-- System-generated notifications are written by SECURITY DEFINER functions,
-- so this policy does not affect them.
drop policy if exists notif_insert on public.notifications;
create policy "notif_insert" on public.notifications for insert
  with check (
    auth.uid() is not null
    and public.has_permission('notifications.send')
    and (public.is_super_admin() or hospital_id = public.app_hospital_id())
    and exists (
      select 1 from public.profiles p
      where p.id = recipient_id
        and (public.is_super_admin() or p.hospital_id = public.app_hospital_id())
    )
  );
