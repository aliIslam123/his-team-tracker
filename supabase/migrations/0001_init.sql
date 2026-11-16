-- HIS Team Tracker initial schema

create extension if not exists "uuid-ossp";

-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('admin','supervisor','team_member')) default 'team_member',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- departments
create table if not exists public.departments (
  id uuid primary key default uuid_generate_v4(),
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- staff_members
create table if not exists public.staff_members (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  job_type text not null check (job_type in ('Doctor','Specialist Doctor','Head Nurse','Nurse','Administration')),
  department_id uuid references public.departments(id) on delete set null,
  his_user_id text,
  legacy_status text,
  legacy_status_reviewed boolean not null default false,
  is_active boolean not null default true,
  registration_status text not null default 'not_started' check (registration_status in ('registered','pending','not_started','needs_followup')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id)
);
create unique index if not exists staff_his_user_id_unique on public.staff_members(his_user_id) where his_user_id is not null;

-- interactions
create table if not exists public.interactions (
  id uuid primary key default uuid_generate_v4(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  reporter_name text not null,
  reporter_phone text not null,
  recorded_by uuid references public.profiles(id),
  interaction_type text not null default 'visit',
  outcome text not null,
  reason_category text,
  reason_detail text,
  notes text,
  had_laptop boolean not null default false,
  had_internet boolean not null default false,
  explanation_provided boolean not null default false,
  explicit_refusal boolean not null default false,
  followup_scheduled boolean not null default false,
  eligible_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- interaction_support
create table if not exists public.interaction_support (
  id uuid primary key default uuid_generate_v4(),
  interaction_id uuid not null references public.interactions(id) on delete cascade,
  support_type text not null
);

-- follow_ups
create table if not exists public.follow_ups (
  id uuid primary key default uuid_generate_v4(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  interaction_id uuid references public.interactions(id) on delete set null,
  assigned_to uuid references public.profiles(id),
  due_date date not null,
  notes text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  status text not null default 'scheduled' check (status in ('pending','scheduled','in_progress','completed','cancelled','overdue')),
  outcome text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- escalation_drafts
create table if not exists public.escalation_drafts (
  id uuid primary key default uuid_generate_v4(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  total_points integer not null default 0,
  status text not null default 'pending_review' check (status in ('draft','pending_review','approved','rejected','returned')),
  draft_text text,
  supervisor_notes text,
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

-- escalation_reviews
create table if not exists public.escalation_reviews (
  id uuid primary key default uuid_generate_v4(),
  escalation_draft_id uuid not null references public.escalation_drafts(id) on delete cascade,
  reviewer_id uuid references public.profiles(id),
  action text not null check (action in ('approve','reject','return')),
  notes text,
  created_at timestamptz not null default now()
);

-- notifications
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  type text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- audit_logs
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- import_jobs
create table if not exists public.import_jobs (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid references public.profiles(id),
  file_name text,
  status text not null default 'pending',
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  review_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- import_rows
create table if not exists public.import_rows (
  id uuid primary key default uuid_generate_v4(),
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  raw_data jsonb,
  mapped_data jsonb,
  status text,
  matched_staff_id uuid references public.staff_members(id),
  resolution text,
  created_at timestamptz not null default now()
);

-- scoring_rules
create table if not exists public.scoring_rules (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  label_ar text not null,
  label_en text not null,
  points integer not null default 0,
  description_ar text,
  description_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.staff_members enable row level security;
alter table public.interactions enable row level security;
alter table public.interaction_support enable row level security;
alter table public.follow_ups enable row level security;
alter table public.escalation_drafts enable row level security;
alter table public.escalation_reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
alter table public.scoring_rules enable row level security;

-- helper: is admin/supervisor
create or replace function public.current_role() returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- policies
-- profiles
create policy "profiles_select" on public.profiles for select using (auth.uid() is not null);
create policy "profiles_update_self" on public.profiles for update using (auth.uid() = id);
create policy "profiles_admin_all" on public.profiles for all using (public.current_role() = 'admin');

-- departments
create policy "departments_select" on public.departments for select using (auth.uid() is not null);
create policy "departments_admin_write" on public.departments for all using (public.current_role() = 'admin');

-- staff_members
create policy "staff_select" on public.staff_members for select using (auth.uid() is not null);
create policy "staff_insert" on public.staff_members for insert with check (auth.uid() is not null);
create policy "staff_update" on public.staff_members for update using (auth.uid() is not null);
create policy "staff_delete_admin" on public.staff_members for delete using (public.current_role() = 'admin');

-- interactions
create policy "interactions_select" on public.interactions for select using (auth.uid() is not null);
create policy "interactions_insert" on public.interactions for insert with check (auth.uid() is not null);
create policy "interactions_update" on public.interactions for update using (recorded_by = auth.uid() or public.current_role() in ('admin','supervisor'));

-- interaction_support
create policy "is_select" on public.interaction_support for select using (auth.uid() is not null);
create policy "is_insert" on public.interaction_support for insert with check (auth.uid() is not null);

-- follow_ups
create policy "fu_select" on public.follow_ups for select using (auth.uid() is not null);
create policy "fu_insert" on public.follow_ups for insert with check (auth.uid() is not null);
create policy "fu_update" on public.follow_ups for update using (auth.uid() is not null);

-- escalation_drafts
create policy "esc_select" on public.escalation_drafts for select using (auth.uid() is not null);
create policy "esc_insert" on public.escalation_drafts for insert with check (auth.uid() is not null);
create policy "esc_update_supervisor" on public.escalation_drafts for update using (public.current_role() in ('admin','supervisor'));

-- escalation_reviews
create policy "er_select" on public.escalation_reviews for select using (auth.uid() is not null);
create policy "er_insert_supervisor" on public.escalation_reviews for insert with check (public.current_role() in ('admin','supervisor'));

-- notifications
create policy "notif_select" on public.notifications for select using (recipient_id = auth.uid());
create policy "notif_update" on public.notifications for update using (recipient_id = auth.uid());
create policy "notif_insert" on public.notifications for insert with check (auth.uid() is not null);

-- audit_logs (immutable: select only; no update/delete)
create policy "audit_select" on public.audit_logs for select using (auth.uid() is not null);
create policy "audit_insert" on public.audit_logs for insert with check (auth.uid() is not null);

-- import_jobs
create policy "import_jobs_select" on public.import_jobs for select using (public.current_role() = 'admin');
create policy "import_jobs_insert" on public.import_jobs for insert with check (public.current_role() = 'admin');
create policy "import_jobs_update" on public.import_jobs for update using (public.current_role() = 'admin');

-- import_rows
create policy "import_rows_select" on public.import_rows for select using (public.current_role() = 'admin');
create policy "import_rows_insert" on public.import_rows for insert with check (public.current_role() = 'admin');

-- scoring_rules
create policy "sr_select" on public.scoring_rules for select using (auth.uid() is not null);
create policy "sr_admin" on public.scoring_rules for all using (public.current_role() = 'admin');

-- trigger to create profile on signup
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'team_member')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger staff_touch before update on public.staff_members for each row execute function public.touch_updated_at();
create trigger interactions_touch before update on public.interactions for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- manual score adjustments
alter table public.staff_members add column if not exists manual_score integer not null default 0;
