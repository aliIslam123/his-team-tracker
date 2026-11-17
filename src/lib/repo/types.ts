import type {
  AuditRecord,
  BedImportResult,
  BedImportRow,
  BedInput,
  BedPatch,
  BedRecord,
  CreateUserInput,
  Department,
  EscalationRecord,
  EvaluationRecord,
  FollowupRecord,
  FollowupStatus,
  Hospital,
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
  UpdateUserInput,
  UserAccount,
} from "@/lib/types";

/**
 * One interface, two backends:
 *  - demo.ts  → browser localStorage (used when no Supabase env vars are set)
 *  - live.ts  → Supabase (RLS + SQL functions from supabase/migrations)
 * Every page talks to this interface only, so they all see the same data.
 *
 * Hospital isolation: rows are scoped by RLS on the server. super_admin picks a hospital
 * with setHospitalScope() (or null to see everything); other roles are scoped automatically.
 */
export interface Repo {
  mode: "demo" | "live";

  /** super_admin only: filter every list by a hospital id (null = all hospitals). */
  setHospitalScope(hospitalId: string | null): void;

  /* public evaluation form at /h/<slug>/ — no login required */
  searchStaffPublic(slug: string, query: string): Promise<StaffLite[]>;
  addStaffPublic(slug: string, input: { full_name: string; job_type: StaffLite["job_type"]; his_user_id?: string | null }): Promise<StaffLite>;
  submitEvaluationPublic(slug: string, input: SubmitEvaluationInput): Promise<SubmitEvaluationResult>;
  publicStatsPublic(slug: string): Promise<PublicStats>;

  /* hospitals (managed from the admin screens by super_admin) */
  listHospitals(): Promise<Hospital[]>;
  createHospital(name: string): Promise<Hospital>;
  updateHospital(id: string, patch: { name?: string; is_active?: boolean }): Promise<void>;

  /* engineer accounts — created by an admin only (Route Handler + service role in live mode) */
  listUsers(hospitalId?: string): Promise<UserAccount[]>;
  createUser(input: CreateUserInput): Promise<{ user: UserAccount; password: string }>;
  updateUser(id: string, patch: UpdateUserInput): Promise<void>;
  resetUserPassword(id: string): Promise<{ password: string }>;

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
