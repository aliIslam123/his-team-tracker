-- HIS Team Tracker — 0004: bed follow-up board (replaces the Google/Excel "follow up" sheet).
-- Run AFTER 0001_init.sql and 0002_integration.sql.
-- Safe to re-run (idempotent).

-- One row per bed. The list of tasks (diagnosis, vitals, ...) and which group they belong to
-- (doctors / nurses) lives in src/lib/beds.ts, NOT here: `tasks` is a free jsonb map of
-- { task_key: true|false }, so adding / renaming / moving a task never needs a migration.
create table if not exists public.bed_followups (
  id uuid primary key default uuid_generate_v4(),
  location text not null default '',          -- "Hall 1", "Room 4", ...
  bed_no integer not null check (bed_no > 0),
  owner_name text not null default '',        -- team member responsible for following this bed up
  patient_name text not null default '',
  notes text not null default '',
  dr_edit_date date,                          -- last date a doctor edited the patient file in the HIS
  nurse_edit_date date,                       -- last date a nurse edited the patient file in the HIS
  tasks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  constraint bed_followups_location_bed_unique unique (location, bed_no),
  constraint bed_followups_tasks_is_object check (jsonb_typeof(tasks) = 'object')
);

create index if not exists bed_followups_owner_idx on public.bed_followups (owner_name);

drop trigger if exists bed_followups_touch on public.bed_followups;
create trigger bed_followups_touch before update on public.bed_followups
  for each row execute function public.touch_updated_at();

-- RLS: every signed-in team member can read and tick things off (that is the whole point);
-- only admin/supervisor can delete a bed row.
alter table public.bed_followups enable row level security;

drop policy if exists "bed_select" on public.bed_followups;
drop policy if exists "bed_insert" on public.bed_followups;
drop policy if exists "bed_update" on public.bed_followups;
drop policy if exists "bed_delete" on public.bed_followups;

create policy "bed_select" on public.bed_followups for select using (auth.uid() is not null);
create policy "bed_insert" on public.bed_followups for insert with check (auth.uid() is not null);
create policy "bed_update" on public.bed_followups for update using (auth.uid() is not null);
create policy "bed_delete" on public.bed_followups for delete using (public.app_role() in ('admin', 'supervisor'));

-- Atomic tick / untick. Two people ticking different tasks on the same bed at the same moment must
-- not overwrite each other, so the merge happens inside one UPDATE (a plain read-modify-write from
-- the browser could lose a tick). SECURITY INVOKER: RLS above still applies to the caller.
create or replace function public.patch_bed_tasks(p_bed_id uuid, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_tasks'; end if;
  if exists (select 1 from jsonb_each(p_patch) e where jsonb_typeof(e.value) <> 'boolean') then raise exception 'invalid_tasks'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k !~ '^[a-z_]{1,32}$') then raise exception 'invalid_tasks'; end if;

  update public.bed_followups
     set tasks = tasks || p_patch,
         updated_by = auth.uid()
   where id = p_bed_id;

  if not found then raise exception 'bed_not_found'; end if;
end;
$$;

revoke all on function public.patch_bed_tasks(uuid, jsonb) from public;
grant execute on function public.patch_bed_tasks(uuid, jsonb) to authenticated;
