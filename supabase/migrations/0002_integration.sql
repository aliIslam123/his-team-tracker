-- HIS Team Tracker — 0002: integration, security fixes and server-side evaluation logic.
-- Run AFTER 0001_init.sql and BEFORE seed.sql / seed_staff.sql.
-- Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1) Schema additions
-- ---------------------------------------------------------------------------
alter table public.staff_members add column if not exists manual_score integer not null default 0;
alter table public.staff_members add column if not exists needs_review boolean not null default false;

create index if not exists interactions_staff_idx on public.interactions (staff_member_id, created_at desc);
create index if not exists follow_ups_due_idx on public.follow_ups (status, due_date);
create index if not exists escalation_staff_idx on public.escalation_drafts (staff_member_id, status);
create index if not exists audit_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Role helper (NULL-safe, avoids the reserved word "current_role")
-- ---------------------------------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 3) Security fixes to RLS
-- ---------------------------------------------------------------------------
-- (a) A user could previously update their own profile row INCLUDING the role column
--     (privilege escalation to admin). Users may now only change their own non-role fields.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.app_role());

-- (b) Only admins/supervisors may edit staff records (scores are changed through SQL functions only).
drop policy if exists "staff_update" on public.staff_members;
create policy "staff_update" on public.staff_members for update
  using (public.app_role() in ('admin', 'supervisor'));

-- (c) Follow-ups: any signed-in team member may update, but not delete (no delete policy exists).
-- (d) Audit logs stay append-only: there is deliberately no update/delete policy.

-- ---------------------------------------------------------------------------
-- 4) Public (anonymous) functions used by the evaluation form
--    SECURITY DEFINER + strict validation: the form never gets direct table access.
-- ---------------------------------------------------------------------------

-- Search by name (Arabic-normalised) or HIS id. Returns at most 10 rows, only safe fields.
create or replace function public.search_staff(p_query text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(r), '[]'::json) from (
    select id, full_name, job_type, his_user_id
    from public.staff_members
    where is_active
      and length(trim(coalesce(p_query, ''))) >= 2
      and (
        translate(lower(full_name), 'أإآىةؤئ', 'ااايهوي')
          like '%' || translate(lower(replace(replace(trim(p_query), '%', ''), '_', '')), 'أإآىةؤئ', 'ااايهوي') || '%'
        or coalesce(his_user_id, '') ilike '%' || replace(replace(trim(p_query), '%', ''), '_', '') || '%'
      )
    order by full_name
    limit 10
  ) r;
$$;

-- Add a person from the public form (flagged needs_review so an admin can verify).
create or replace function public.add_staff_public(p_full_name text, p_job_type text, p_his_user_id text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_his text := nullif(trim(coalesce(p_his_user_id, '')), '');
  v_row public.staff_members%rowtype;
begin
  if length(v_name) < 3 then raise exception 'invalid_name'; end if;
  if p_job_type not in ('Doctor','Specialist Doctor','Head Nurse','Nurse','Administration') then
    raise exception 'invalid_job_type';
  end if;

  select * into v_row from public.staff_members
   where (v_his is not null and his_user_id = v_his)
      or translate(lower(full_name), 'أإآىةؤئ', 'ااايهوي') = translate(lower(v_name), 'أإآىةؤئ', 'ااايهوي')
   limit 1;

  if not found then
    insert into public.staff_members (full_name, job_type, his_user_id, is_active, registration_status, needs_review)
    values (v_name, p_job_type, v_his, true, 'not_started', true)
    returning * into v_row;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_values)
    values (auth.uid(), 'staff_added_from_form', 'staff_member', v_row.id, jsonb_build_object('full_name', v_name));
  end if;

  return json_build_object('id', v_row.id, 'full_name', v_row.full_name, 'job_type', v_row.job_type, 'his_user_id', v_row.his_user_id);
end;
$$;

-- Aggregate counts only (no personal data) for the form's summary block.
create or replace function public.public_stats() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total',      count(*) filter (where is_active),
    'registered', count(*) filter (where is_active and registration_status = 'registered'),
    'pending',    count(*) filter (where is_active and registration_status <> 'registered'),
    'review',     count(*) filter (where is_active and manual_score <= -3)
  ) from public.staff_members;
$$;

-- The evaluation itself. Points are computed HERE, so a client can never forge a score.
-- Also: updates registration status, schedules the follow-up, writes the audit trail and,
-- when the net score reaches -3 (see ESCALATION_THRESHOLD in src/lib/evaluation.ts),
-- opens an escalation draft and notifies every admin/supervisor.
create or replace function public.submit_evaluation(
  p_staff_id uuid,
  p_reporter_name text,
  p_reporter_phone text,
  p_result text,
  p_notes text default null,
  p_followup_date date default null,
  p_followup_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_reporter_phone, ''), '\s', '', 'g');
  v_name text := trim(coalesce(p_reporter_name, ''));
  v_points int;
  v_staff public.staff_members%rowtype;
  v_score int;
  v_eval_id uuid;
  v_escalated boolean := false;
  v_esc_id uuid;
begin
  if length(v_name) < 2 then raise exception 'invalid_reporter_name'; end if;
  if v_phone !~ '^01[0125][0-9]{8}$' then raise exception 'invalid_phone'; end if;

  v_points := case
    when p_result in ('registered','cooperated','accepted_training','completed_steps') then 1
    when p_result in ('refused','busy_refused','postponed','refused_assistance','left_incomplete') then -1
    when p_result in ('busy_medical','emergency','not_available','system_problem','requested_appointment','admin_delay','other') then 0
    else null end;
  if v_points is null then raise exception 'invalid_result'; end if;

  select * into v_staff from public.staff_members where id = p_staff_id and is_active for update;
  if not found then raise exception 'staff_not_found'; end if;

  insert into public.interactions (
    staff_member_id, reporter_name, reporter_phone, recorded_by, interaction_type,
    outcome, notes, followup_scheduled, eligible_points
  ) values (
    p_staff_id, v_name, v_phone, auth.uid(), 'evaluation',
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
    insert into public.follow_ups (staff_member_id, interaction_id, due_date, notes, priority, status, created_by)
    values (p_staff_id, v_eval_id, p_followup_date, nullif(trim(coalesce(p_followup_note, '')), ''), 'medium', 'scheduled', auth.uid());
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_values)
  values (auth.uid(), 'evaluation', 'staff_member', p_staff_id,
          jsonb_build_object('result', p_result, 'points', v_points, 'evaluator', v_name,
                             'notes', nullif(trim(coalesce(p_notes, '')), '')));

  if v_score <= -3 and not exists (
    select 1 from public.escalation_drafts
     where staff_member_id = p_staff_id and status in ('draft', 'pending_review', 'returned')
  ) then
    insert into public.escalation_drafts (staff_member_id, total_points, status, draft_text)
    values (p_staff_id, v_score, 'pending_review', '')
    returning id into v_esc_id;
    v_escalated := true;

    insert into public.notifications (recipient_id, title, body, type, link)
    select id, 'Escalation needs review / تصعيد بانتظار المراجعة',
           v_staff.full_name || ' (' || v_score || ')', 'escalation', '/escalations/' || v_esc_id
      from public.profiles where role in ('admin', 'supervisor');
  end if;

  return json_build_object('points', v_points, 'new_score', v_score, 'escalated', v_escalated);
end;
$$;

-- Reset a score WITHOUT deleting history (the old UI deleted audit rows, which RLS also blocked).
create or replace function public.reset_staff_score(p_staff_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_prev int;
begin
  if coalesce(public.app_role(), '') not in ('admin', 'supervisor') then raise exception 'not_allowed'; end if;
  select manual_score into v_prev from public.staff_members where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found'; end if;
  update public.staff_members set manual_score = 0 where id = p_staff_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_values, new_values, reason)
  values (auth.uid(), 'score_reset', 'staff_member', p_staff_id,
          jsonb_build_object('manual_score', v_prev), jsonb_build_object('manual_score', 0), p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.search_staff(text) from public;
revoke all on function public.add_staff_public(text, text, text) from public;
revoke all on function public.public_stats() from public;
revoke all on function public.submit_evaluation(uuid, text, text, text, text, date, text) from public;
revoke all on function public.reset_staff_score(uuid, text) from public;

grant execute on function public.search_staff(text) to anon, authenticated;
grant execute on function public.add_staff_public(text, text, text) to anon, authenticated;
grant execute on function public.public_stats() to anon, authenticated;
grant execute on function public.submit_evaluation(uuid, text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.reset_staff_score(uuid, text) to authenticated;
