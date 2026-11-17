export type Role = "super_admin" | "hospital_admin" | "supervisor" | "member";

export type JobType = "Doctor" | "Specialist Doctor" | "Head Nurse" | "Nurse" | "Administration";

export type RegistrationStatus = "registered" | "pending" | "not_started" | "needs_followup";

/** super_admin: all hospitals (hospital_id null) · the rest are bound to exactly one hospital. */
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  username?: string | null;
  hospital_id?: string | null;
  /** Per-module toggles defined in src/lib/permissions.ts (stage 2). */
  permissions?: Record<string, boolean> | null;
  job_title?: string | null;
  /** Forces a password change on the next sign-in. */
  must_change_password?: boolean;
  is_active?: boolean;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Hospital {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** An engineer account (created by an admin only) as shown in the admin screens. */
export interface UserAccount {
  id: string;
  username: string | null;
  email: string | null;
  full_name: string;
  job_title: string | null;
  role: Role;
  hospital_id: string | null;
  permissions?: Record<string, boolean> | null;
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CreateUserInput {
  hospital_id: string;
  username: string;
  full_name: string;
  job_title?: string | null;
  role: Role;
  must_change_password: boolean;
}

export type UpdateUserInput = Partial<Pick<UserAccount, "full_name" | "job_title" | "role" | "is_active">> & {
  /** super_admin only: move an account to another hospital. */
  hospital_id?: string;
  /** Per-user permission overrides (keys of PERMISSION_KEYS). Admins may change others, never themselves. */
  permissions?: Record<string, boolean> | null;
};

export interface Department {
  id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  created_at: string;
}

export interface StaffMember {
  id: string;
  hospital_id?: string | null;
  full_name: string;
  job_type: JobType;
  department_id: string | null;
  his_user_id: string | null;
  /** The member account responsible for this staff member (drives the member's history scope). */
  assigned_to?: string | null;
  assignee?: { full_name: string } | null;
  legacy_status: string | null;
  legacy_status_reviewed: boolean;
  is_active: boolean;
  registration_status: RegistrationStatus;
  manual_score: number;
  needs_review?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  department?: Department | null;
}

export type InteractionOutcome =
  | "registered"
  | "started_not_completed"
  | "busy"
  | "postponed"
  | "refused"
  | "not_available"
  | "avoided"
  | "technical_problem"
  | "needs_training"
  | "other";

export type ReasonCategory =
  | "clinical_workload"
  | "postponement"
  | "non_cooperation"
  | "technical"
  | "training"
  | "other";

export interface Interaction {
  id: string;
  staff_member_id: string;
  reporter_name: string;
  reporter_phone: string;
  recorded_by: string;
  interaction_type: string;
  outcome: InteractionOutcome;
  reason_category: ReasonCategory | null;
  reason_detail: string | null;
  notes: string | null;
  had_laptop: boolean;
  had_internet: boolean;
  explanation_provided: boolean;
  explicit_refusal: boolean;
  followup_scheduled: boolean;
  eligible_points: number;
  created_at: string;
  updated_at: string;
  staff_member?: StaffMember;
}

export interface InteractionSupport {
  id: string;
  interaction_id: string;
  support_type: string;
}

export type FollowupStatus = "pending" | "scheduled" | "in_progress" | "completed" | "cancelled" | "overdue";

export interface Followup {
  id: string;
  staff_member_id: string;
  interaction_id: string | null;
  assigned_to: string | null;
  due_date: string;
  notes: string | null;
  priority: "low" | "medium" | "high";
  status: FollowupStatus;
  outcome: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  staff_member?: StaffMember;
}

export type EscalationStatus = "draft" | "pending_review" | "approved" | "rejected" | "returned";

export interface EscalationDraft {
  id: string;
  staff_member_id: string;
  total_points: number;
  status: EscalationStatus;
  draft_text: string;
  supervisor_notes: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  staff_member?: StaffMember;
}

export interface EscalationReview {
  id: string;
  escalation_draft_id: string;
  reviewer_id: string;
  action: "approve" | "reject" | "return";
  notes: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  title: string;
  body: string;
  type: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_values: unknown;
  new_values: unknown;
  reason: string | null;
  created_at: string;
}

export interface ScoringRule {
  id: string;
  key: string;
  label_ar: string;
  label_en: string;
  points: number;
  description_ar: string;
  description_en: string;
  is_active: boolean;
}

export interface ImportJob {
  id: string;
  created_by: string;
  file_name: string;
  status: string;
  total_rows: number;
  imported_count: number;
  duplicate_count: number;
  invalid_count: number;
  review_count: number;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* View models returned by the data layer (src/lib/repo)               */
/* ------------------------------------------------------------------ */

export interface StaffLite {
  id: string;
  full_name: string;
  job_type: JobType;
  his_user_id: string | null;
}

export interface StaffInput {
  full_name: string;
  job_type: JobType;
  department_id?: string | null;
  his_user_id?: string | null;
}

export interface StaffPatch extends Partial<StaffInput> {
  is_active?: boolean;
  needs_review?: boolean;
  /** member account responsible for this staff member (null = unassign) */
  assigned_to?: string | null;
}

/** One evaluation of a staff member, as submitted from the public form. */
export interface EvaluationRecord {
  id: string;
  staff_member_id: string;
  staff_name: string;
  job_type: string;
  reporter_name: string;
  reporter_phone: string;
  /** Signed-in engineer who recorded it (null for anonymous public-form submissions). */
  recorded_by?: string | null;
  result: string;
  points: number;
  notes: string | null;
  created_at: string;
}

export interface FollowupRecord {
  id: string;
  staff_member_id: string;
  staff_name: string;
  due_date: string;
  notes: string | null;
  priority: "low" | "medium" | "high";
  status: FollowupStatus;
  created_at: string;
  completed_at: string | null;
}

export interface EscalationRecord {
  id: string;
  staff_member_id: string;
  staff_name: string;
  job_type: string;
  total_points: number;
  status: EscalationStatus;
  draft_text: string;
  supervisor_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface AuditRecord {
  id: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_values: unknown;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface PublicStats {
  total: number;
  registered: number;
  pending: number;
  review: number;
}

export interface SubmitEvaluationInput {
  staffId: string;
  reporterName: string;
  reporterPhone: string;
  result: string;
  notes?: string | null;
  followupDate?: string | null;
  followupNote?: string | null;
}

export interface SubmitEvaluationResult {
  points: number;
  newScore: number;
  escalated: boolean;
}

export interface ImportRowInput {
  full_name: string;
  job_type: JobType;
  his_user_id: string | null;
  legacy_status: string | null;
  department_id?: string | null;
  needs_review?: boolean;
}

export interface ImportResult {
  imported: number;
  failed: number;
}

/* ------------------------------------------------------------------ */
/* Bed follow-up board (src/lib/beds.ts holds the task list)           */
/* ------------------------------------------------------------------ */

/** One bed on the follow-up board = one row of the old Google/Excel sheet. */
export interface BedRecord {
  id: string;
  hospital_id?: string | null;
  location: string;
  bed_no: number;
  owner_name: string;
  patient_name: string;
  notes: string;
  /** Last date a doctor edited the patient file in the HIS (YYYY-MM-DD). */
  dr_edit_date: string | null;
  /** Last date a nurse edited the patient file in the HIS (YYYY-MM-DD). */
  nurse_edit_date: string | null;
  /** { task_key: done } — keys are defined in BED_TASKS. A missing key means "not done". */
  tasks: Record<string, boolean>;
  updated_at: string;
  updated_by_name: string | null;
}

export interface BedInput {
  location: string;
  bed_no: number;
  owner_name: string;
  patient_name?: string;
  notes?: string;
}

export type BedPatch = Partial<Pick<BedRecord, "location" | "bed_no" | "owner_name" | "patient_name" | "notes" | "dr_edit_date" | "nurse_edit_date">>;

/** A row read from the old sheet, ready to be created / merged into the board. */
export interface BedImportRow {
  location: string;
  bed_no: number;
  owner_name: string;
  patient_name: string;
  notes: string;
  dr_edit_date: string | null;
  nurse_edit_date: string | null;
  tasks: Record<string, boolean>;
}

export interface BedImportResult {
  created: number;
  updated: number;
  failed: number;
}

/* ------------------------------------------------------------------ */
/* Comparison dashboard (super_admin only, from compare_hospitals())   */
/* ------------------------------------------------------------------ */

/** One hospital's headline numbers, as shown on the comparison dashboard. */
export interface HospitalComparison {
  hospital_id: string;
  hospital_name: string;
  hospital_slug: string;
  hospital_active: boolean;
  staff_total: number;
  staff_registered: number;
  staff_pending: number;
  evaluations_total: number;
  evaluations_7d: number;
  followups_open: number;
  followups_overdue: number;
  escalations_pending: number;
}
