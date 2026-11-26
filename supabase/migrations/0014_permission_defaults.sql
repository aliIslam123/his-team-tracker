-- Holool His — 0014: permission defaults match src/lib/permissions.ts.
-- Run AFTER 0013_permissions_and_scope.sql. Safe to re-run (idempotent).
--   supervisor: staff management + assignment, escalations, follow-ups,
--               analytics, beds, notifications. Import / user management /
--               activity log / clearing evaluations removed (overrides can restore).
--   member:     beds assigned + his own work only. Analytics/escalations removed.

create or replace function public.has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           nullif(u.permissions ->> p_permission, '')::boolean,
           case u.role
             when 'super_admin'    then true
             when 'hospital_admin' then p_permission in (
               'staff.manage','staff.import','staff.assign','staff.clear','users.manage',
               'activity.view','escalations.review','followups.manage','analytics.view',
               'beds.manage','notifications.send')
             when 'supervisor'     then p_permission in (
               'staff.manage','staff.assign','escalations.review',
               'followups.manage','analytics.view','beds.manage','notifications.send')
             when 'member'         then p_permission in ('beds.assigned')
             else false
           end
         ) = true
    from public.profiles u
   where u.id = p_user_id;
$$;
