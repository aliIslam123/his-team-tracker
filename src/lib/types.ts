export type Role = "admin" | "supervisor" | "team_member";

export type JobType = "Doctor" | "Specialist Doctor" | "Head Nurse" | "Nurse" | "Administration";

export type RegistrationStatus = "registered" | "pending" | "not_started" | "needs_followup";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  created_at: string;
}

export interface StaffMember {
  id: string;
  full_name: string;
  job_type: JobType;
  department_id: string | null;
  his_user_id: string | null;
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
}

/** One evaluation of a staff member, as submitted from the public form. */
export interface EvaluationRecord {
  id: string;
  staff_member_id: string;
  staff_name: string;
  job_type: string;
  reporter_name: string;
  reporter_phone: string;
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
