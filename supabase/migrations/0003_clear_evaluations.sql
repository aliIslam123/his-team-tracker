-- HIS Team Tracker — 0003: clear evaluations (delete evaluations + reset score)
-- Run AFTER 0001_init.sql and 0002_integration.sql.
-- Safe to re-run (idempotent).

-- Delete every evaluation (interaction) for a staff member, zero their score,
-- and log the operation in audit_logs. Only admin/supervisor can run it.
create or replace function public.clear_staff_evaluations(p_staff_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev int;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'supervisor') then raise exception 'not_allowed'; end if;
  select manual_score into v_prev from public.staff_members where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found'; end if;

  delete from public.interactions
   where staff_member_id = p_staff_id
     and interaction_type = 'evaluation';

  update public.staff_members set manual_score = 0 where id = p_staff_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_values, new_values, reason)
  values (auth.uid(), 'evaluations_cleared', 'staff_member', p_staff_id,
          jsonb_build_object('manual_score', v_prev), jsonb_build_object('manual_score', 0), p_reason);
end;
$$;

revoke all on function public.clear_staff_evaluations(uuid, text) from public;
grant execute on function public.clear_staff_evaluations(uuid, text) to authenticated;
