import { createClient } from "@/lib/supabase/client";
import { OPEN_ESCALATION_STATUSES } from "@/lib/evaluation";
import type {
  AuditRecord,
  Department,
  EscalationRecord,
  EvaluationRecord,
  FollowupRecord,
  FollowupStatus,
  ImportResult,
  ImportRowInput,
  Notification,
  PublicStats,
  StaffLite,
  StaffMember,
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

async function writeAudit(entry: { action: string; entity_type: string; entity_id: string | null; previous_values?: unknown; new_values?: unknown; reason?: string | null }) {
  const actor = await currentUserId();
  await sb().from("audit_logs").insert({ actor_id: actor, ...entry });
}

export const liveRepo: Repo = {
  mode: "live",

  /* ---------------- public (anon-callable SQL functions) ---------------- */

  async searchStaff(query) {
    if (query.trim().length < 2) return [];
    const { data, error } = await sb().rpc("search_staff", { p_query: query.trim() });
    if (error) fail(error);
    return (data as StaffLite[]) ?? [];
  },

  async getStaffLite(id) {
    const { data } = await sb().from("staff_members").select("id, full_name, job_type, his_user_id").eq("id", id).maybeSingle();
    return (data as StaffLite | null) ?? null;
  },

  async addStaffFromForm(input) {
    const { data, error } = await sb().rpc("add_staff_public", {
      p_full_name: input.full_name,
      p_job_type: input.job_type,
      p_his_user_id: input.his_user_id ?? null,
    });
    if (error) fail(error);
    return data as StaffLite;
  },

  async submitEvaluation(input) {
    const { data, error } = await sb().rpc("submit_evaluation", {
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

  async publicStats(): Promise<PublicStats> {
    const { data, error } = await sb().rpc("public_stats");
    if (error) fail(error);
    return data as PublicStats;
  },

  /* ---------------- staff ---------------- */

  async listStaff() {
    return fetchAll<StaffMember>((from, to) =>
      sb().from("staff_members").select("*, department:departments(*)").order("full_name").range(from, to) as any
    );
  },

  async getStaff(id) {
    const { data } = await sb().from("staff_members").select("*, department:departments(*)").eq("id", id).maybeSingle();
    return (data as StaffMember | null) ?? null;
  },

  async createStaff(input) {
    const uid = await currentUserId();
    const { data, error } = await sb()
      .from("staff_members")
      .insert({
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
      const { data, error } = await base().limit(opts.limit);
      if (error) fail(error);
      return ((data as any[]) ?? []).map(mapEvaluation);
    }
    const rows = await fetchAll<any>((from, to) => base().range(from, to) as any);
    return rows.map(mapEvaluation);
  },

  async listFollowups(opts) {
    const rows = await fetchAll<any>((from, to) => {
      let q = sb().from("follow_ups").select("*, staff:staff_members(full_name)").order("due_date", { ascending: true });
      if (opts?.staffId) q = q.eq("staff_member_id", opts.staffId);
      return q.range(from, to) as any;
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
      return q.range(from, to) as any;
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
      .insert({ staff_member_id: staffId, total_points: (staff as any)?.manual_score ?? 0, status: "pending_review", draft_text: "" })
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
    await sb().from("escalation_reviews").insert({ escalation_draft_id: id, reviewer_id: uid, action, notes: notes || null });
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
    const { data, error } = await sb()
      .from("audit_logs")
      .select("*, actor:profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data as any[]) ?? []).map((r) => ({
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
    const { data: job } = await sb()
      .from("import_jobs")
      .insert({ created_by: uid, file_name: fileName, status: "processing", total_rows: rows.length })
      .select("id")
      .single();

    const toRow = (r: ImportRowInput) => ({
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
};
