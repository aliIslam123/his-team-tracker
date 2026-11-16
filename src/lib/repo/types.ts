import type {
  AuditRecord,
  BedImportResult,
  BedImportRow,
  BedInput,
  BedPatch,
  BedRecord,
  Department,
  EscalationRecord,
  EvaluationRecord,
  FollowupRecord,
  FollowupStatus,
  ImportResult,
  ImportRowInput,
  Notification,
  PublicStats,
  StaffInput,
  StaffLite,
  StaffMember,
  StaffPatch,
  SubmitEvaluationInput,
  SubmitEvaluationResult,
} from "@/lib/types";

/**
 * One interface, two backends:
 *  - demo.ts  → browser localStorage (used when no Supabase env vars are set)
 *  - live.ts  → Supabase (RLS + SQL functions from supabase/migrations)
 * Every page talks to this interface only, so they all see the same data.
 */
export interface Repo {
  mode: "demo" | "live";

  /* public (used by the evaluation form, no login required) */
  searchStaff(query: string): Promise<StaffLite[]>;
  getStaffLite(id: string): Promise<StaffLite | null>;
  addStaffFromForm(input: { full_name: string; job_type: StaffLite["job_type"]; his_user_id?: string | null }): Promise<StaffLite>;
  submitEvaluation(input: SubmitEvaluationInput): Promise<SubmitEvaluationResult>;
  publicStats(): Promise<PublicStats>;

  /* staff */
  listStaff(): Promise<StaffMember[]>;
  getStaff(id: string): Promise<StaffMember | null>;
  createStaff(input: StaffInput): Promise<StaffMember>;
  updateStaff(id: string, patch: StaffPatch): Promise<void>;
  resetScore(id: string, reason?: string): Promise<void>;
  clearEvaluations(id: string, reason?: string): Promise<void>;
  listDepartments(): Promise<Department[]>;

  /* evaluations / follow-ups */
  listEvaluations(opts?: { staffId?: string; limit?: number }): Promise<EvaluationRecord[]>;
  listFollowups(opts?: { staffId?: string }): Promise<FollowupRecord[]>;
  setFollowupStatus(id: string, status: FollowupStatus): Promise<void>;

  /* escalations */
  listEscalations(opts?: { staffId?: string }): Promise<EscalationRecord[]>;
  getEscalation(id: string): Promise<EscalationRecord | null>;
  createEscalation(staffId: string): Promise<string>;
  saveEscalationDraft(id: string, draftText: string): Promise<void>;
  reviewEscalation(id: string, action: "approve" | "reject" | "return", draftText: string, notes: string): Promise<void>;

  /* notifications / audit */
  listNotifications(): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  listAudits(limit?: number): Promise<AuditRecord[]>;

  /* bulk import */
  importStaff(rows: ImportRowInput[], fileName: string): Promise<ImportResult>;

  /* bed follow-up board (replaces the Google/Excel sheet) */
  listBeds(): Promise<BedRecord[]>;
  createBed(input: BedInput): Promise<BedRecord>;
  updateBed(id: string, patch: BedPatch): Promise<void>;
  /** Tick / untick one or many tasks. Merged atomically so two people never overwrite each other. */
  setBedTasks(id: string, patch: Record<string, boolean>): Promise<void>;
  /** Patient left: clears name, notes, dates and every tick (the bed itself stays). */
  dischargeBed(id: string): Promise<void>;
  deleteBed(id: string): Promise<void>;
  /** Creates missing beds and overwrites existing ones (matched by location + bed number). */
  importBeds(rows: BedImportRow[], fileName: string): Promise<BedImportResult>;
}
