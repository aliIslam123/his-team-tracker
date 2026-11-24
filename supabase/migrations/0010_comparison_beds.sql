-- Holool His — 0010: include bed follow-ups in the hospital comparison.
-- Run AFTER 0009_production_hardening.sql. Safe to re-run (idempotent).
-- Beds are the patient follow-up board, so a hospital comparison must show
-- how many bed records it has and how many still need work.
--
-- The task keys below mirror BED_TASKS in src/lib/beds.ts — keep them in sync.

create or replace function public.compare_hospitals()
returns table (
  hospital_id uuid, hospital_name text, hospital_slug text, hospital_active boolean,
  staff_total bigint, staff_registered bigint, staff_pending bigint,
  evaluations_total bigint, evaluations_7d bigint,
  followups_open bigint, followups_overdue bigint, escalations_pending bigint,
  beds_total bigint, beds_open bigint
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
        where e.hospital_id = h.id and e.status in ('draft','pending_review','returned')),
      (select count(*) from public.bed_followups b where b.hospital_id = h.id),
      (select count(*) from public.bed_followups b
        where b.hospital_id = h.id
          and not (coalesce(b.tasks, '{}'::jsonb) @> '{"diagnosis":true,"complaints":true,"procedures":true,"medicine":true,"oxygen_chest":true,"feeding":true,"apache":true,"lab":true,"vitals":true,"initial":true,"daily":true,"fluid":true,"turning":true,"invasive":true}'::jsonb))
    from public.hospitals h
    order by h.name;
end;
$$;

revoke all on function public.compare_hospitals() from public, anon;
grant execute on function public.compare_hospitals() to authenticated;
