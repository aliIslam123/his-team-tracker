import { DEMO_STAFF } from "@/data/demo-staff";
import { ESCALATION_THRESHOLD, OPEN_ESCALATION_STATUSES, getOption, normalizeArabic, normalizeDigits, pointsFor } from "@/lib/evaluation";
import type {
  AuditRecord,
  Department,
  EscalationRecord,
  EscalationStatus,
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
import type { Repo } from "@/lib/repo/types";

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export const DEMO_DB_KEY = "his_demo_db_v2";
import { DEMO_SESSION_KEY } from "@/lib/demo-auth";
const LEGACY_SCORES_KEY = "his_demo_scores";
const LEGACY_AUDIT_KEY = "his_demo_audit";

interface DemoDB {
  v: 2;
  staff: StaffMember[];
  evaluations: EvaluationRecord[];
  followups: FollowupRecord[];
  escalations: EscalationRecord[];
  notifications: Notification[];
  audits: AuditRecord[];
}

const FIXED_DATE = "2026-01-01T00:00:00.000Z";
export const DEMO_DEPARTMENTS: Department[] = [
  { id: "demo-dept-1", name_ar: "الباطنة", name_en: "Internal Medicine", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-2", name_ar: "الجراحة", name_en: "Surgery", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-3", name_ar: "الطوارئ", name_en: "Emergency", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-4", name_ar: "التمريض", name_en: "Nursing", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-5", name_ar: "الإدارة", name_en: "Administration", is_active: true, created_at: FIXED_DATE },
];

const nowIso = () => new Date().toISOString();
const newId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function actorName(): string {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (raw) return JSON.parse(raw).name ?? "Demo Admin";
  } catch {}
  return "Demo Admin";
}

function buildSeed(): DemoDB {
  const t = nowIso();
  const staff: StaffMember[] = DEMO_STAFF.map(([full_name, job_type, his, legacy, review], i) => ({
    id: `demo-${i}`,
    full_name,
    job_type,
    department_id: null,
    his_user_id: his,
    legacy_status: legacy,
    legacy_status_reviewed: false,
    is_active: true,
    registration_status: "not_started",
    manual_score: 0,
    needs_review: review,
    created_at: t,
    updated_at: t,
    created_by: null,
    updated_by: null,
  }));
  const db: DemoDB = { v: 2, staff, evaluations: [], followups: [], escalations: [], notifications: [], audits: [] };
  migrateLegacy(db);
  return db;
}

/** Carries over scores/evaluations saved by the previous (v1) demo build, so nothing is lost on upgrade. */
function migrateLegacy(db: DemoDB) {
  try {
    const scores = JSON.parse(localStorage.getItem(LEGACY_SCORES_KEY) ?? "{}") as Record<string, number>;
    for (const s of db.staff) if (typeof scores[s.id] === "number") s.manual_score = scores[s.id];
    const audits = JSON.parse(localStorage.getItem(LEGACY_AUDIT_KEY) ?? "[]") as Array<{
      id: string; action: string; entity_id: string | null; created_at: string;
      new_values?: { result?: string; points?: number; notes?: string; evaluator?: string; phone?: string };
    }>;
    for (const a of audits.slice().reverse()) {
      if (a.action !== "evaluation" || !a.entity_id) continue;
      const staff = db.staff.find((s) => s.id === a.entity_id);
      if (!staff || !a.new_values?.result) continue;
      db.evaluations.unshift({
        id: a.id,
        staff_member_id: staff.id,
        staff_name: staff.full_name,
        job_type: staff.job_type,
        reporter_name: a.new_values.evaluator ?? "-",
        reporter_phone: a.new_values.phone ?? "",
        result: a.new_values.result,
        points: a.new_values.points ?? pointsFor(a.new_values.result),
        notes: a.new_values.notes ?? null,
        created_at: a.created_at,
      });
      if (a.new_values.result === "registered") staff.registration_status = "registered";
      else if (staff.registration_status === "not_started") staff.registration_status = "pending";
    }
  } catch {}
}

let cache: DemoDB | null = null;
let listening = false;

function db(): DemoDB {
  if (typeof window === "undefined") throw new Error("Demo repository is browser-only");
  if (!listening) {
    listening = true;
    window.addEventListener("storage", (e) => { if (e.key === DEMO_DB_KEY) cache = null; });
  }
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(DEMO_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDB;
      if (parsed?.v === 2) { cache = parsed; return cache; }
    }
  } catch {}
  cache = buildSeed();
  save();
  return cache;
}

function save() {
  if (!cache) return;
  try { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(cache)); } catch {}
}

export function resetDemoData() {
  cache = null;
  try {
    localStorage.removeItem(DEMO_DB_KEY);
    localStorage.removeItem(LEGACY_SCORES_KEY);
    localStorage.removeItem(LEGACY_AUDIT_KEY);
  } catch {}
}

export function exportDemoData(): string {
  return JSON.stringify(db(), null, 2);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const toLite = (s: StaffMember): StaffLite => ({ id: s.id, full_name: s.full_name, job_type: s.job_type, his_user_id: s.his_user_id });
const withDept = (s: StaffMember): StaffMember => ({ ...s, department: DEMO_DEPARTMENTS.find((d) => d.id === s.department_id) ?? null });

function audit(d: DemoDB, a: Pick<AuditRecord, "action" | "entity_type" | "entity_id"> & Partial<AuditRecord>) {
  d.audits.unshift({
    id: newId(),
    actor_name: actorName(),
    previous_values: null,
    new_values: null,
    reason: null,
    created_at: nowIso(),
    ...a,
  });
  if (d.audits.length > 1000) d.audits.length = 1000;
}

function notify(d: DemoDB, title: string, body: string, type: string, link: string | null) {
  d.notifications.unshift({ id: newId(), recipient_id: "demo-admin", title, body, type, link, is_read: false, created_at: nowIso() });
  if (d.notifications.length > 300) d.notifications.length = 300;
}

function hasOpenEscalation(d: DemoDB, staffId: string) {
  return d.escalations.some((e) => e.staff_member_id === staffId && (OPEN_ESCALATION_STATUSES as readonly string[]).includes(e.status));
}

function openEscalation(d: DemoDB, staff: StaffMember): EscalationRecord {
  const esc: EscalationRecord = {
    id: newId(),
    staff_member_id: staff.id,
    staff_name: staff.full_name,
    job_type: staff.job_type,
    total_points: staff.manual_score,
    status: "pending_review",
    draft_text: "",
    supervisor_notes: null,
    created_at: nowIso(),
    reviewed_at: null,
  };
  d.escalations.unshift(esc);
  notify(d, "Escalation needs review / تصعيد بانتظار المراجعة", `${staff.full_name} (${staff.manual_score})`, "escalation", `/escalations/${esc.id}`);
  return esc;
}

function sameName(a: string, b: string) {
  return normalizeArabic(a) === normalizeArabic(b);
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export const demoRepo: Repo = {
  mode: "demo",

  async searchStaff(query) {
    const q = normalizeArabic(query);
    if (q.length < 2) return [];
    const digits = normalizeDigits(query.trim());
    return db().staff
      .filter((s) => s.is_active && (normalizeArabic(s.full_name).includes(q) || (s.his_user_id ?? "").includes(digits)))
      .slice(0, 10)
      .map(toLite);
  },

  async getStaffLite(id) {
    const s = db().staff.find((x) => x.id === id);
    return s ? toLite(s) : null;
  },

  async addStaffFromForm(input) {
    const d = db();
    const name = input.full_name.replace(/\s+/g, " ").trim();
    if (name.length < 3) throw new Error("invalid_name");
    const his = input.his_user_id?.trim() || null;
    const existing = d.staff.find((s) => (his && s.his_user_id === his) || sameName(s.full_name, name));
    if (existing) return toLite(existing);
    const t = nowIso();
    const s: StaffMember = {
      id: newId(), full_name: name, job_type: input.job_type, department_id: null, his_user_id: his,
      legacy_status: null, legacy_status_reviewed: false, is_active: true, registration_status: "not_started",
      manual_score: 0, needs_review: true, created_at: t, updated_at: t, created_by: null, updated_by: null,
    };
    d.staff.push(s);
    audit(d, { action: "staff_added_from_form", entity_type: "staff_member", entity_id: s.id, new_values: { full_name: name } });
    save();
    return toLite(s);
  },

  async submitEvaluation(input: SubmitEvaluationInput): Promise<SubmitEvaluationResult> {
    const d = db();
    const staff = d.staff.find((s) => s.id === input.staffId && s.is_active);
    if (!staff) throw new Error("staff_not_found");
    if (!getOption(input.result)) throw new Error("invalid_result");
    if (input.reporterName.trim().length < 2) throw new Error("invalid_reporter_name");
    if (!/^01[0125]\d{8}$/.test(input.reporterPhone)) throw new Error("invalid_phone");

    const points = pointsFor(input.result);
    const t = nowIso();
    d.evaluations.unshift({
      id: newId(), staff_member_id: staff.id, staff_name: staff.full_name, job_type: staff.job_type,
      reporter_name: input.reporterName.trim(), reporter_phone: input.reporterPhone, result: input.result,
      points, notes: input.notes?.trim() || null, created_at: t,
    });

    staff.manual_score += points;
    staff.updated_at = t;
    if (input.result === "registered") staff.registration_status = "registered";
    else if (staff.registration_status !== "registered") {
      if (input.followupDate) staff.registration_status = "needs_followup";
      else if (staff.registration_status === "not_started") staff.registration_status = "pending";
    }

    if (input.followupDate) {
      d.followups.unshift({
        id: newId(), staff_member_id: staff.id, staff_name: staff.full_name, due_date: input.followupDate,
        notes: input.followupNote?.trim() || null, priority: "medium", status: "scheduled", created_at: t, completed_at: null,
      });
    }

    audit(d, {
      action: "evaluation", entity_type: "staff_member", entity_id: staff.id,
      new_values: { result: input.result, points, evaluator: input.reporterName.trim(), notes: input.notes ?? null },
    });

    let escalated = false;
    if (staff.manual_score <= ESCALATION_THRESHOLD && !hasOpenEscalation(d, staff.id)) {
      openEscalation(d, staff);
      escalated = true;
    }
    save();
    return { points, newScore: staff.manual_score, escalated };
  },

  async publicStats(): Promise<PublicStats> {
    const active = db().staff.filter((s) => s.is_active);
    const registered = active.filter((s) => s.registration_status === "registered").length;
    return {
      total: active.length,
      registered,
      pending: active.length - registered,
      review: active.filter((s) => s.manual_score <= ESCALATION_THRESHOLD).length,
    };
  },

  async listStaff() {
    return db().staff.map(withDept).sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
  },

  async getStaff(id) {
    const s = db().staff.find((x) => x.id === id);
    return s ? withDept(s) : null;
  },

  async createStaff(input: StaffInput) {
    const d = db();
    const his = input.his_user_id?.trim() || null;
    if (his && d.staff.some((s) => s.his_user_id === his)) throw new Error("duplicate_his_id");
    const t = nowIso();
    const s: StaffMember = {
      id: newId(), full_name: input.full_name.replace(/\s+/g, " ").trim(), job_type: input.job_type,
      department_id: input.department_id ?? null, his_user_id: his, legacy_status: null, legacy_status_reviewed: false,
      is_active: true, registration_status: "not_started", manual_score: 0, needs_review: false,
      created_at: t, updated_at: t, created_by: "demo-admin", updated_by: "demo-admin",
    };
    d.staff.push(s);
    audit(d, { action: "staff_created", entity_type: "staff_member", entity_id: s.id, new_values: { full_name: s.full_name } });
    save();
    return withDept(s);
  },

  async updateStaff(id, patch: StaffPatch) {
    const d = db();
    const s = d.staff.find((x) => x.id === id);
    if (!s) throw new Error("staff_not_found");
    const his = patch.his_user_id === undefined ? s.his_user_id : patch.his_user_id?.trim() || null;
    if (his && d.staff.some((x) => x.id !== id && x.his_user_id === his)) throw new Error("duplicate_his_id");
    const before = { full_name: s.full_name, job_type: s.job_type, department_id: s.department_id, his_user_id: s.his_user_id, is_active: s.is_active };
    if (patch.full_name !== undefined) s.full_name = patch.full_name.replace(/\s+/g, " ").trim();
    if (patch.job_type !== undefined) s.job_type = patch.job_type;
    if (patch.department_id !== undefined) s.department_id = patch.department_id;
    s.his_user_id = his;
    if (patch.is_active !== undefined) s.is_active = patch.is_active;
    if (patch.needs_review !== undefined) s.needs_review = patch.needs_review;
    s.updated_at = nowIso();
    s.updated_by = "demo-admin";
    audit(d, { action: "staff_updated", entity_type: "staff_member", entity_id: id, previous_values: before, new_values: { ...patch } });
    save();
  },

  async resetScore(id, reason) {
    const d = db();
    const s = d.staff.find((x) => x.id === id);
    if (!s) throw new Error("staff_not_found");
    const previous = s.manual_score;
    s.manual_score = 0;
    s.updated_at = nowIso();
    // History (evaluations + audit) is preserved; the reset itself is logged.
    audit(d, { action: "score_reset", entity_type: "staff_member", entity_id: id, previous_values: { manual_score: previous }, new_values: { manual_score: 0 }, reason: reason ?? null });
    save();
  },

  async listDepartments() {
    return DEMO_DEPARTMENTS;
  },

  async listEvaluations(opts) {
    let list = db().evaluations;
    if (opts?.staffId) list = list.filter((e) => e.staff_member_id === opts.staffId);
    list = list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? list.slice(0, opts.limit) : list;
  },

  async listFollowups(opts) {
    let list = db().followups;
    if (opts?.staffId) list = list.filter((f) => f.staff_member_id === opts.staffId);
    return list.slice().sort((a, b) => a.due_date.localeCompare(b.due_date));
  },

  async setFollowupStatus(id, status: FollowupStatus) {
    const d = db();
    const f = d.followups.find((x) => x.id === id);
    if (!f) return;
    f.status = status;
    f.completed_at = status === "completed" ? nowIso() : null;
    audit(d, { action: `followup_${status}`, entity_type: "follow_up", entity_id: id });
    save();
  },

  async listEscalations(opts) {
    let list = db().escalations;
    if (opts?.staffId) list = list.filter((e) => e.staff_member_id === opts.staffId);
    return list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async getEscalation(id) {
    return db().escalations.find((e) => e.id === id) ?? null;
  },

  async createEscalation(staffId) {
    const d = db();
    const staff = d.staff.find((s) => s.id === staffId);
    if (!staff) throw new Error("staff_not_found");
    const open = d.escalations.find((e) => e.staff_member_id === staffId && (OPEN_ESCALATION_STATUSES as readonly string[]).includes(e.status));
    if (open) return open.id;
    const esc = openEscalation(d, staff);
    audit(d, { action: "escalation_created", entity_type: "escalation_draft", entity_id: esc.id });
    save();
    return esc.id;
  },

  async saveEscalationDraft(id, draftText) {
    const d = db();
    const e = d.escalations.find((x) => x.id === id);
    if (!e) return;
    e.draft_text = draftText;
    save();
  },

  async reviewEscalation(id, action, draftText, notes) {
    const d = db();
    const e = d.escalations.find((x) => x.id === id);
    if (!e) throw new Error("staff_not_found");
    const status: EscalationStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "returned";
    e.status = status;
    e.draft_text = draftText;
    e.supervisor_notes = notes || null;
    e.reviewed_at = nowIso();
    audit(d, { action: `escalation_${action}`, entity_type: "escalation_draft", entity_id: id, new_values: { status } });
    save();
  },

  async listNotifications() {
    return db().notifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  async markNotificationRead(id) {
    const n = db().notifications.find((x) => x.id === id);
    if (n) { n.is_read = true; save(); }
  },

  async markAllNotificationsRead() {
    db().notifications.forEach((n) => { n.is_read = true; });
    save();
  },

  async listAudits(limit = 200) {
    return db().audits.slice(0, limit);
  },

  async importStaff(rows: ImportRowInput[], _fileName: string): Promise<ImportResult> {
    void _fileName;
    const d = db();
    let imported = 0;
    let failed = 0;
    const t = nowIso();
    for (const r of rows) {
      if (r.his_user_id && d.staff.some((s) => s.his_user_id === r.his_user_id)) { failed++; continue; }
      d.staff.push({
        id: newId(), full_name: r.full_name, job_type: r.job_type, department_id: r.department_id ?? null,
        his_user_id: r.his_user_id, legacy_status: r.legacy_status, legacy_status_reviewed: false, is_active: true,
        registration_status: "not_started", manual_score: 0, needs_review: r.needs_review ?? false,
        created_at: t, updated_at: t, created_by: "demo-admin", updated_by: "demo-admin",
      });
      imported++;
    }
    audit(d, { action: "staff_import", entity_type: "import_job", entity_id: null, new_values: { file: _fileName, total: rows.length, imported, failed } });
    save();
    return { imported, failed };
  },
};
