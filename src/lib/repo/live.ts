import { createClient } from "@/lib/supabase/client";
import { OPEN_ESCALATION_STATUSES } from "@/lib/evaluation";
import { cleanText, normalizeLocation } from "@/lib/beds";
import { slugifyName } from "@/lib/slug";
import type {
  AuditRecord,
  BedImportResult,
  BedImportRow,
  BedRecord,
  CreateUserInput,
  Department,
  EscalationRecord,
  EvaluationRecord,
  FollowupRecord,
  FollowupStatus,
  Hospital,
  HospitalComparison,
  ImportResult,
  ImportRowInput,
  Notification,
  PublicStats,
  StaffLite,
  StaffMember,
  SubmitEvaluationInput,
  SubmitEvaluationResult,
  UpdateUserInput,
  UserAccount,
} from "@/lib/types";
import type { Repo } from "@/lib/repo/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const sb = () => createClient();

function fail(error: { message?: string } | null | undefined): never {
  throw new Error(error?.message ?? "error");
}

async function currentUserId(): Promise<string | null> {
  const { data } = await sb().auth.getUser();
  return data.user?.id ?? null;
}

/** Pages through a query so lists are not silently truncated at PostgREST's 1000-row default. */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await make(from, from + size - 1);
    if (error) fail(error);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* hospital scope (super_admin switcher)                               */
/* ------------------------------------------------------------------ */

let scopeId: string | null = null;

/** super_admin only: restrict every list to one hospital (null = all hospitals). RLS already scopes everyone else. */
export function setLiveHospitalScope(hospitalId: string | null) {
  scopeId = hospitalId;
}

/** Applies the super_admin's hospital filter to a query when a scope is active. */
function withScope(q: any): any {
  return scopeId ? q.eq("hospital_id", scopeId) : q;
}

/* ------------------------------------------------------------------ */
/* hospital_id stamping: RLS requires inserts to carry the caller's hospital */
/* ------------------------------------------------------------------ */

let actorHospital: string | null | undefined; // undefined = not loaded yet

async function actorHospitalId(): Promise<string | null> {
  if (actorHospital !== undefined) return actorHospital;
  const uid = await currentUserId();
  if (!uid) return null;
  const { data } = await sb().from("profiles").select("hospital_id").eq("id", uid).maybeSingle();
  const hospital: string | null = (data as any)?.hospital_id ?? null;
  actorHospital = hospital;
  return hospital;
}

/** The hospital id to stamp on new rows: the active scope (super_admin) or the caller's own hospital. */
async function hospitalForWrite(): Promise<string | null> {
  if (scopeId) return scopeId;
  return actorHospitalId();
}

/* ------------------------------------------------------------------ */
/* row mappers                                                         */
/* ------------------------------------------------------------------ */

const mapEvaluation = (r: any): EvaluationRecord => ({
  id: r.id,
  staff_member_id: r.staff_member_id,
  staff_name: r.staff?.full_name ?? "-",
  job_type: r.staff?.job_type ?? "",
  reporter_name: r.reporter_name,
  reporter_phone: r.reporter_phone,
  result: r.outcome,
  points: r.eligible_points ?? 0,
  notes: r.notes,
  created_at: r.created_at,
});

const mapFollowup = (r: any): FollowupRecord => ({
  id: r.id,
  staff_member_id: r.staff_member_id,
  staff_name: r.staff?.full_name ?? "-",
  assigned_to: r.assigned_to ?? null,
  due_date: r.due_date,
  notes: r.notes,
  priority: r.priority,
  status: r.status,
  created_at: r.created_at,
  completed_at: r.completed_at,
});

const mapEscalation = (r: any): EscalationRecord => ({
  id: r.id,
  staff_member_id: r.staff_member_id,
  staff_name: r.staff?.full_name ?? "-",
  job_type: r.staff?.job_type ?? "",
  total_points: r.total_points ?? 0,
  status: r.status,
  draft_text: r.draft_text ?? "",
  supervisor_notes: r.supervisor_notes,
  created_at: r.created_at,
  reviewed_at: r.reviewed_at,
});

const mapBed = (r: any): BedRecord => ({
  id: r.id,
  hospital_id: r.hospital_id ?? null,
  location: r.location ?? "",
  bed_no: r.bed_no,
  owner_name: r.owner_name ?? "",
  patient_name: r.patient_name ?? "",
  notes: r.notes ?? "",
  dr_edit_date: r.dr_edit_date ?? null,
  nurse_edit_date: r.nurse_edit_date ?? null,
  tasks: r.tasks && typeof r.tasks === "object" ? (r.tasks as Record<string, boolean>) : {},
  updated_at: r.updated_at,
  updated_by_name: r.updater?.full_name ?? null,
});

const toAccount = (p: any): UserAccount => ({
  id: p.id,
  username: p.username ?? null,
  email: p.email ?? null,
  full_name: p.full_name ?? "",
  job_title: p.job_title ?? null,
  role: p.role ?? "member",
  hospital_id: p.hospital_id ?? null,
  permissions: p.permissions ?? {},
  must_change_password: Boolean(p.must_change_password),
  is_active: p.is_active !== false,
  created_at: p.created_at ?? new Date().toISOString(),
});

// bed_followups has two foreign keys to profiles (created_by, updated_by), so the embed must name the one it wants
const BED_SELECT = "*, updater:profiles!updated_by(full_name)";

/** audit_logs rows carry hospital_id (the RLS policy requires the caller's own hospital or NULL). */
async function writeAudit(entry: { action: string; entity_type: string; entity_id: string | null; previous_values?: unknown; new_values?: unknown; reason?: string | null }) {
  const actor = await currentUserId();
  const hospitalId = await hospitalForWrite();
  await sb().from("audit_logs").insert({ actor_id: actor, hospital_id: hospitalId, ...entry });
}

/* ------------------------------------------------------------------ */
/* admin Route Handlers (service role lives on the server only)         */
/* ------------------------------------------------------------------ */

async function callAdminApi(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "error");
  return body;
}

export const liveRepo: Repo = {
  mode: "live",

  setHospitalScope(hospitalId) {
    setLiveHospitalScope(hospitalId);
  },

  /* ---------------- public form at /h/<slug>/ (slug-scoped SQL functions) ---------------- */

  async searchStaffPublic(slug, query) {
    if (query.trim().length < 2) return [];
    const { data, error } = await sb().rpc("search_staff_h", { p_slug: slug, p_query: query.trim() });
    if (error) fail(error);
    return (data as StaffLite[]) ?? [];
  },

  async addStaffPublic(slug, input) {
    const { data, error } = await sb().rpc("add_staff_public_h", {
      p_slug: slug,
      p_full_name: input.full_name,
      p_job_type: input.job_type,
      p_his_user_id: input.his_user_id ?? null,
    });
    if (error) fail(error);
    return data as StaffLite;
  },

  async submitEvaluationPublic(slug, input: SubmitEvaluationInput): Promise<SubmitEvaluationResult> {
    const { data, error } = await sb().rpc("submit_evaluation_h", {
      p_slug: slug,
      p_staff_id: input.staffId,
      p_reporter_name: input.reporterName,
      p_reporter_phone: input.reporterPhone,
      p_result: input.result,
      p_notes: input.notes ?? null,
      p_followup_date: input.followupDate || null,
      p_followup_note: input.followupNote ?? null,
    });
    if (error) fail(error);
    const r = data as { points: number; new_score: number; escalated: boolean };
    return { points: r.points, newScore: r.new_score, escalated: r.escalated };
  },

  async publicStatsPublic(slug): Promise<PublicStats> {
    const { data, error } = await sb().rpc("public_stats_h", { p_slug: slug });
    if (error) fail(error);
    return data as PublicStats;
  },

  /* ---------------- hospitals (managed by super_admin) ---------------- */

  async listHospitals() {
    const { data, error } = await sb().from("hospitals").select("*").order("created_at");
    if (error) fail(error);
    return (data as Hospital[]) ?? [];
  },

  async createHospital(name) {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2) throw new Error("invalid_name");
    const base = slugifyName(clean);
    for (let i = 1; i <= 30; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      const { data, error } = await sb().from("hospitals").insert({ name: clean, slug }).select("*").single();
      if (!error) return data as Hospital;
      if (error.code !== "23505") fail(error); // slug already taken → try the next suffix
    }
    throw new Error("duplicate_slug");
  },

  async updateHospital(id, patch) {
    const { error } = await sb().from("hospitals").update(patch).eq("id", id);
    if (error) fail(error);
  },

  async compareHospitals(): Promise<HospitalComparison[]> {
    const { data, error } = await sb().rpc("compare_hospitals");
    if (error) fail(error);
    return (data as HospitalComparison[]) ?? [];
  },

  /* ---------------- engineer accounts (created by an admin only) ---------------- */

  async listUsers(hospitalId) {
    const target = hospitalId ?? scopeId;
    const rows = await fetchAll<any>((from, to) => {
      let q = sb().from("profiles").select("*").order("full_name");
      if (target) q = q.eq("hospital_id", target);
      return q.range(from, to) as any;
    });
    return rows.map(toAccount);
  },

  async createUser(input: CreateUserInput) {
    const body = await callAdminApi("/api/admin/users", { method: "POST", body: JSON.stringify(input) });
    return { user: body.user as UserAccount, password: body.password as string };
  },

  async updateUser(id, patch: UpdateUserInput) {
    await callAdminApi(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async resetUserPassword(id) {
    const body = await callAdminApi(`/api/admin/users/${id}/password`, { method: "POST" });
    return { password: body.password as string };
  },

  /* ---------------- staff ---------------- */

  async listStaff() {
    return fetchAll<StaffMember>((from, to) =>
      withScope(
        sb().from("staff_members").select("*, department:departments(*), assignee:profiles!assigned_to(full_name)").order("full_name")
      ).range(from, to) as any
    );
  },

  async getStaff(id) {
    const { data } = await sb()
      .from("staff_members")
      .select("*, department:departments(*), assignee:profiles!assigned_to(full_name)")
      .eq("id", id)
      .maybeSingle();
    return (data as StaffMember | null) ?? null;
  },

  async createStaff(input) {
    const uid = await currentUserId();
    const { data, error } = await sb()
      .from("staff_members")
      .insert({
        hospital_id: await hospitalForWrite(),
        full_name: input.full_name.replace(/\s+/g, " ").trim(),
        job_type: input.job_type,
        department_id: input.department_id || null,
        his_user_id: input.his_user_id?.trim() || null,
        is_active: true,
        registration_status: "not_started",
        created_by: uid,
        updated_by: uid,
      })
      .select("*, department:departments(*)")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_his_id");
      fail(error);
    }
    await writeAudit({ action: "staff_created", entity_type: "staff_member", entity_id: (data as any).id, new_values: { full_name: (data as any).full_name } });
    return data as StaffMember;
  },

  async updateStaff(id, patch) {
    const uid = await currentUserId();
    const row: Record<string, unknown> = { updated_by: uid };
    if (patch.full_name !== undefined) row.full_name = patch.full_name.replace(/\s+/g, " ").trim();
    if (patch.job_type !== undefined) row.job_type = patch.job_type;
    if (patch.department_id !== undefined) row.department_id = patch.department_id || null;
    if (patch.his_user_id !== undefined) row.his_user_id = patch.his_user_id?.trim() || null;
    if (patch.is_active !== undefined) row.is_active = patch.is_active;
    if (patch.needs_review !== undefined) row.needs_review = patch.needs_review;
    if (patch.assigned_to !== undefined) row.assigned_to = patch.assigned_to || null;
    const { error } = await sb().from("staff_members").update(row).eq("id", id);
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_his_id");
      fail(error);
    }
    await writeAudit({ action: "staff_updated", entity_type: "staff_member", entity_id: id, new_values: patch });
  },

  async resetScore(id, reason) {
    const { error } = await sb().rpc("reset_staff_score", { p_staff_id: id, p_reason: reason ?? null });
    if (error) fail(error);
  },

  async clearEvaluations(id, reason) {
    const { error } = await sb().rpc("clear_staff_evaluations", { p_staff_id: id, p_reason: reason ?? null });
    if (error) fail(error);
  },

  async listDepartments() {
    const { data, error } = await sb().from("departments").select("*").eq("is_active", true).order("name_ar");
    if (error) fail(error);
    return (data as Department[]) ?? [];
  },

  /* ---------------- evaluations / follow-ups ---------------- */

  async listEvaluations(opts) {
    const base = () => {
      let q = sb()
        .from("interactions")
        .select("id, staff_member_id, reporter_name, reporter_phone, outcome, eligible_points, notes, created_at, staff:staff_members(full_name, job_type)")
        .eq("interaction_type", "evaluation")
        .order("created_at", { ascending: false });
      if (opts?.staffId) q = q.eq("staff_member_id", opts.staffId);
      return q;
    };
    if (opts?.limit) {
      const { data, error } = await withScope(base()).limit(opts.limit);
      if (error) fail(error);
      return ((data as any[]) ?? []).map(mapEvaluation);
    }
    const rows = await fetchAll<any>((from, to) => withScope(base()).range(from, to) as any);
    return rows.map(mapEvaluation);
  },

  async listFollowups(opts) {
    const rows = await fetchAll<any>((from, to) => {
      let q = sb().from("follow_ups").select("*, staff:staff_members(full_name)").order("due_date", { ascending: true });
      if (opts?.staffId) q = q.eq("staff_member_id", opts.staffId);
      return withScope(q).range(from, to) as any;
    });
    return rows.map(mapFollowup);
  },

  async setFollowupStatus(id, status: FollowupStatus) {
    const { error } = await sb()
      .from("follow_ups")
      .update({ status, completed_at: status === "completed" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) fail(error);
    await writeAudit({ action: `followup_${status}`, entity_type: "follow_up", entity_id: id });
  },

  /* ---------------- escalations ---------------- */

  async listEscalations(opts) {
    const rows = await fetchAll<any>((from, to) => {
      let q = sb().from("escalation_drafts").select("*, staff:staff_members(full_name, job_type)").order("created_at", { ascending: false });
      if (opts?.staffId) q = q.eq("staff_member_id", opts.staffId);
      return withScope(q).range(from, to) as any;
    });
    return rows.map(mapEscalation);
  },

  async getEscalation(id) {
    const { data } = await sb().from("escalation_drafts").select("*, staff:staff_members(full_name, job_type)").eq("id", id).maybeSingle();
    return data ? mapEscalation(data) : null;
  },

  async createEscalation(staffId) {
    const { data: open } = await sb()
      .from("escalation_drafts")
      .select("id")
      .eq("staff_member_id", staffId)
      .in("status", [...OPEN_ESCALATION_STATUSES])
      .limit(1);
    if (open && open.length) return (open[0] as any).id as string;
    const { data: staff } = await sb().from("staff_members").select("manual_score").eq("id", staffId).single();
    const { data, error } = await sb()
      .from("escalation_drafts")
      .insert({
        hospital_id: await hospitalForWrite(),
        staff_member_id: staffId,
        total_points: (staff as any)?.manual_score ?? 0,
        status: "pending_review",
        draft_text: "",
      })
      .select("id")
      .single();
    if (error) fail(error);
    await writeAudit({ action: "escalation_created", entity_type: "escalation_draft", entity_id: (data as any).id });
    return (data as any).id as string;
  },

  async saveEscalationDraft(id, draftText) {
    const { error } = await sb().from("escalation_drafts").update({ draft_text: draftText }).eq("id", id);
    if (error) fail(error);
  },

  async reviewEscalation(id, action, draftText, notes) {
    const uid = await currentUserId();
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "returned";
    const { error } = await sb()
      .from("escalation_drafts")
      .update({ status, draft_text: draftText, supervisor_notes: notes || null, reviewed_by: uid, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail(error);
    await sb().from("escalation_reviews").insert({ hospital_id: await hospitalForWrite(), escalation_draft_id: id, reviewer_id: uid, action, notes: notes || null });
    await writeAudit({ action: `escalation_${action}`, entity_type: "escalation_draft", entity_id: id, new_values: { status } });
  },

  /* ---------------- notifications / audit ---------------- */

  async listNotifications() {
    const uid = await currentUserId();
    if (!uid) return [];
    const { data, error } = await sb().from("notifications").select("*").eq("recipient_id", uid).order("created_at", { ascending: false }).limit(200);
    if (error) fail(error);
    return (data as Notification[]) ?? [];
  },

  async sendNotification(input) {
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title || !body) throw new Error("invalid_message");
    const { error } = await sb().from("notifications").insert({
      hospital_id: input.hospitalId !== undefined ? input.hospitalId : await hospitalForWrite(),
      recipient_id: input.recipientId,
      title,
      body,
      type: "message",
      link: null,
    });
    if (error) fail(error);
    await writeAudit({ action: "notification_sent", entity_type: "notification", entity_id: input.recipientId, new_values: { title } });
  },

  async markNotificationRead(id) {
    const { error } = await sb().from("notifications").update({ is_read: true }).eq("id", id);
    if (error) fail(error);
  },

  async markAllNotificationsRead() {
    const uid = await currentUserId();
    if (!uid) return;
    const { error } = await sb().from("notifications").update({ is_read: true }).eq("recipient_id", uid).eq("is_read", false);
    if (error) fail(error);
  },

  async listAudits(limit = 200): Promise<AuditRecord[]> {
    const rows = await fetchAll<any>((from, to) =>
      withScope(sb().from("audit_logs").select("*, actor:profiles(full_name)").order("created_at", { ascending: false })).range(from, to) as any
    );
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      actor_name: r.actor?.full_name ?? null,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      previous_values: r.previous_values,
      new_values: r.new_values,
      reason: r.reason,
      created_at: r.created_at,
    }));
  },

  /* ---------------- import ---------------- */

  async importStaff(rows: ImportRowInput[], fileName: string): Promise<ImportResult> {
    const uid = await currentUserId();
    const hospitalId = await hospitalForWrite();
    const { data: job } = await sb()
      .from("import_jobs")
      .insert({ hospital_id: hospitalId, created_by: uid, file_name: fileName, status: "processing", total_rows: rows.length })
      .select("id")
      .single();

    const toRow = (r: ImportRowInput) => ({
      hospital_id: hospitalId,
      full_name: r.full_name,
      job_type: r.job_type,
      his_user_id: r.his_user_id,
      legacy_status: r.legacy_status,
      department_id: r.department_id ?? null,
      needs_review: r.needs_review ?? false,
      legacy_status_reviewed: false,
      is_active: true,
      registration_status: "not_started",
      created_by: uid,
      updated_by: uid,
    });

    let imported = 0;
    let failed = 0;
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await sb().from("staff_members").insert(chunk.map(toRow));
      if (!error) { imported += chunk.length; continue; }
      // one bad row (e.g. unique violation) fails the whole batch → retry row by row
      for (const r of chunk) {
        const { error: e2 } = await sb().from("staff_members").insert(toRow(r));
        if (e2) failed++; else imported++;
      }
    }

    if (job) {
      await sb()
        .from("import_jobs")
        .update({ status: "completed", imported_count: imported, invalid_count: failed })
        .eq("id", (job as any).id);
    }
    await writeAudit({ action: "staff_import", entity_type: "import_job", entity_id: (job as any)?.id ?? null, new_values: { file: fileName, total: rows.length, imported, failed } });
    return { imported, failed };
  },

  /* ---------------- bed follow-up board ---------------- */

  async listBeds() {
    const rows = await fetchAll<any>((from, to) =>
      withScope(sb().from("bed_followups").select(BED_SELECT).order("bed_no").order("location").order("id")).range(from, to) as any
    );
    return rows.map(mapBed);
  },

  async createBed(input) {
    if (!Number.isInteger(input.bed_no) || input.bed_no < 1) throw new Error("invalid_bed");
    const uid = await currentUserId();
    const { data, error } = await sb()
      .from("bed_followups")
      .insert({
        hospital_id: await hospitalForWrite(),
        location: normalizeLocation(input.location),
        bed_no: input.bed_no,
        owner_name: cleanText(input.owner_name),
        patient_name: cleanText(input.patient_name),
        notes: cleanText(input.notes),
        created_by: uid,
        updated_by: uid,
      })
      .select(BED_SELECT)
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_bed");
      fail(error);
    }
    const bed = mapBed(data);
    await writeAudit({ action: "bed_created", entity_type: "bed_followup", entity_id: bed.id, new_values: { location: bed.location, bed_no: bed.bed_no } });
    return bed;
  },

  async updateBed(id, patch) {
    const uid = await currentUserId();
    const row: Record<string, unknown> = { updated_by: uid };
    if (patch.location !== undefined) row.location = normalizeLocation(patch.location);
    if (patch.bed_no !== undefined) {
      if (!Number.isInteger(patch.bed_no) || patch.bed_no < 1) throw new Error("invalid_bed");
      row.bed_no = patch.bed_no;
    }
    if (patch.owner_name !== undefined) row.owner_name = cleanText(patch.owner_name);
    if (patch.patient_name !== undefined) row.patient_name = cleanText(patch.patient_name);
    if (patch.notes !== undefined) row.notes = cleanText(patch.notes);
    if (patch.dr_edit_date !== undefined) row.dr_edit_date = patch.dr_edit_date || null;
    if (patch.nurse_edit_date !== undefined) row.nurse_edit_date = patch.nurse_edit_date || null;
    const { data, error } = await sb().from("bed_followups").update(row).eq("id", id).select("id");
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_bed");
      fail(error);
    }
    if (!data || data.length === 0) throw new Error("bed_not_found");
  },

  async setBedTasks(id, patch) {
    // one atomic UPDATE on the server (see patch_bed_tasks in 0004): concurrent ticks never overwrite each other
    const { error } = await sb().rpc("patch_bed_tasks", { p_bed_id: id, p_patch: patch });
    if (error) fail(error);
  },

  async dischargeBed(id) {
    const uid = await currentUserId();
    const { data, error } = await sb()
      .from("bed_followups")
      .update({ patient_name: "", notes: "", dr_edit_date: null, nurse_edit_date: null, tasks: {}, updated_by: uid })
      .eq("id", id)
      .select("location, bed_no");
    if (error) fail(error);
    if (!data || data.length === 0) throw new Error("bed_not_found");
    // the audit trail records which bed was cleared, never the patient's name
    await writeAudit({ action: "bed_discharged", entity_type: "bed_followup", entity_id: id, new_values: { location: (data[0] as any).location, bed_no: (data[0] as any).bed_no } });
  },

  async deleteBed(id) {
    const { data, error } = await sb().from("bed_followups").delete().eq("id", id).select("location, bed_no");
    if (error) fail(error);
    // RLS lets only admin/supervisor delete; a blocked delete affects 0 rows instead of raising
    if (!data || data.length === 0) throw new Error("not_allowed");
    await writeAudit({ action: "bed_deleted", entity_type: "bed_followup", entity_id: id, new_values: { location: (data[0] as any).location, bed_no: (data[0] as any).bed_no } });
  },

  async importBeds(rows: BedImportRow[], fileName: string): Promise<BedImportResult> {
    const uid = await currentUserId();
    const hospitalId = await hospitalForWrite();
    const existing = await fetchAll<any>((from, to) =>
      withScope(sb().from("bed_followups").select("location, bed_no").order("id")).range(from, to) as any
    );
    const have = new Set(existing.map((r) => `${String(r.location).toLowerCase()}|${r.bed_no}`));
    const isNew = (r: BedImportRow) => !have.has(`${r.location.toLowerCase()}|${r.bed_no}`);

    const base = (r: BedImportRow) => ({
      hospital_id: hospitalId,
      location: r.location, bed_no: r.bed_no, owner_name: r.owner_name, patient_name: r.patient_name, notes: r.notes,
      dr_edit_date: r.dr_edit_date, nurse_edit_date: r.nurse_edit_date, tasks: r.tasks, updated_by: uid,
    });
    // created_by is only set on rows that do not exist yet, so re-importing never overwrites who created a bed
    const toRow = (r: BedImportRow) => (isNew(r) ? { ...base(r), created_by: uid } : base(r));

    let created = 0;
    let updated = 0;
    let failed = 0;
    const upsert = (batch: BedImportRow[]) =>
      sb().from("bed_followups").upsert(batch.map(toRow), { onConflict: "hospital_id,location,bed_no" });

    for (const group of [rows.filter(isNew), rows.filter((r) => !isNew(r))]) {
      const fresh = group.length > 0 && isNew(group[0]);
      const CHUNK = 100;
      for (let i = 0; i < group.length; i += CHUNK) {
        const chunk = group.slice(i, i + CHUNK);
        const { error } = await upsert(chunk);
        if (!error) { if (fresh) created += chunk.length; else updated += chunk.length; continue; }
        // one bad row fails the whole batch → retry row by row so a single problem does not block the rest
        for (const r of chunk) {
          const { error: e2 } = await upsert([r]);
          if (e2) failed++; else if (fresh) created++; else updated++;
        }
      }
    }
    await writeAudit({ action: "beds_import", entity_type: "import_job", entity_id: null, new_values: { file: fileName, total: rows.length, created, updated, failed } });
    return { created, updated, failed };
  },
};
