import { DEMO_STAFF } from "@/data/demo-staff";
import { ESCALATION_THRESHOLD, OPEN_ESCALATION_STATUSES, getOption, normalizeArabic, normalizeDigits, pointsFor } from "@/lib/evaluation";
import { cleanText, compareBeds, normalizeLocation } from "@/lib/beds";
import { slugifyName } from "@/lib/slug";
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
  EscalationStatus,
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
import type { Repo } from "@/lib/repo/types";

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export const DEMO_DB_KEY = "his_demo_db_v2";
import { DEMO_SESSION_KEY, DEMO_PASS, DEMO_USER } from "@/lib/demo-auth";
const LEGACY_SCORES_KEY = "his_demo_scores";
const LEGACY_AUDIT_KEY = "his_demo_audit";

interface DemoUser {
  id: string;
  username: string;
  full_name: string;
  job_title: string | null;
  role: UserAccount["role"];
  hospital_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
  /** Demo accounts live in this browser only, so the password is kept here to allow sign-in. */
  password: string;
  created_at: string;
}

interface DemoDB {
  v: 2;
  staff: StaffMember[];
  evaluations: EvaluationRecord[];
  followups: FollowupRecord[];
  escalations: EscalationRecord[];
  notifications: Notification[];
  audits: AuditRecord[];
  /** Added later: absent in databases saved before the bed board existed. */
  beds?: BedRecord[];
  /** Added in 0005: hospitals + admin-created engineer accounts. */
  hospitals?: Hospital[];
  users?: DemoUser[];
}

const FIXED_DATE = "2026-01-01T00:00:00.000Z";
export const DEMO_DEPARTMENTS: Department[] = [
  { id: "demo-dept-1", name_ar: "الباطنة", name_en: "Internal Medicine", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-2", name_ar: "الجراحة", name_en: "Surgery", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-3", name_ar: "الطوارئ", name_en: "Emergency", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-4", name_ar: "التمريض", name_en: "Nursing", is_active: true, created_at: FIXED_DATE },
  { id: "demo-dept-5", name_ar: "الإدارة", name_en: "Administration", is_active: true, created_at: FIXED_DATE },
];

export const DEMO_MAIN_HOSPITAL_ID = "demo-hospital-1";

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
    hospital_id: DEMO_MAIN_HOSPITAL_ID,
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
  const db: DemoDB = {
    v: 2,
    staff,
    evaluations: [],
    followups: [],
    escalations: [],
    notifications: [],
    audits: [],
    hospitals: [
      { id: DEMO_MAIN_HOSPITAL_ID, name: "عين شمس", slug: "ain-shams", is_active: true, created_at: t, updated_at: t },
    ],
    users: [
      {
        id: "demo-admin",
        username: DEMO_USER,
        full_name: "Demo Admin",
        job_title: "System Administrator",
        role: "super_admin",
        hospital_id: null,
        must_change_password: false,
        is_active: true,
        password: DEMO_PASS,
        created_at: t,
      },
    ],
  };
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
/* Hospital scope (super_admin switcher)                               */
/* ------------------------------------------------------------------ */

let scopeId: string | null = null;

export function setDemoHospitalScope(hospitalId: string | null) {
  scopeId = hospitalId;
}

const DEFAULT_SCOPE = DEMO_MAIN_HOSPITAL_ID;

/**
 * The active hospital filter: super_admin uses the explicit scope (null = all);
 * every other demo account is always limited to its own hospital — mirroring the RLS of live mode.
 */
function effectiveScope(): string | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw) as { username: string };
      const u = usersOf(db()).find((x) => x.username === session.username);
      if (u && u.role !== "super_admin") return u.hospital_id ?? DEFAULT_SCOPE;
    }
  } catch {}
  return scopeId;
}

function inScope(hospitalId: string | null | undefined): boolean {
  const s = effectiveScope();
  return s === null || s === (hospitalId ?? DEFAULT_SCOPE);
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

/* ---------- hospitals ---------- */

function hospitalsOf(d: DemoDB): Hospital[] {
  if (!d.hospitals) {
    d.hospitals = [{ id: DEMO_MAIN_HOSPITAL_ID, name: "عين شمس", slug: "ain-shams", is_active: true, created_at: FIXED_DATE, updated_at: FIXED_DATE }];
  }
  return d.hospitals;
}

const hospitalForSlug = (d: DemoDB, slug: string): Hospital | undefined =>
  hospitalsOf(d).find((h) => h.slug === slug.trim().toLowerCase() && h.is_active);

/** A demo row belongs to the main hospital unless a hospital_id was stamped on it. */
const rowHospital = (x: { hospital_id?: string | null }) => x.hospital_id ?? DEMO_MAIN_HOSPITAL_ID;

const staffInScope = (d: DemoDB) => d.staff.filter((s) => inScope(rowHospital(s)));
const staffHospital = (d: DemoDB, staffId: string) => rowHospital(d.staff.find((s) => s.id === staffId) ?? {});

/* ---------- engineer accounts (demo) ---------- */

function usersOf(d: DemoDB): DemoUser[] {
  if (!d.users) {
    d.users = [
      {
        id: "demo-admin", username: DEMO_USER, full_name: "Demo Admin", job_title: "System Administrator",
        role: "super_admin", hospital_id: null, must_change_password: false, is_active: true,
        password: DEMO_PASS, created_at: FIXED_DATE,
      },
    ];
  }
  return d.users;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function randomPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
  const all = sets.join("");
  const out: string[] = [];
  const pick = (set: string) => {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return set[buf[0] % set.length];
    }
    return set[Math.floor(Math.random() * set.length)];
  };
  for (const s of sets) out.push(pick(s));
  while (out.length < 16) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

const toAccount = (u: DemoUser): UserAccount => ({
  id: u.id, username: u.username, email: `${u.username}@his.local`, full_name: u.full_name,
  job_title: u.job_title, role: u.role, hospital_id: u.hospital_id, permissions: {},
  must_change_password: u.must_change_password, is_active: u.is_active, created_at: u.created_at,
});

/* ---------- bed follow-up board ---------- */

const bedsOf = (d: DemoDB): BedRecord[] => (d.beds ??= []);
const bedKey = (location: string, bed_no: number) => `${location.toLowerCase()}|${bed_no}`;
const validDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function assertBedNo(n: number) {
  if (!Number.isInteger(n) || n < 1) throw new Error("invalid_bed");
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export const demoRepo: Repo = {
  mode: "demo",

  setHospitalScope(hospitalId) {
    setDemoHospitalScope(hospitalId);
  },

  /* ---------------- public form (slug-scoped) ---------------- */

  async searchStaffPublic(slug, query) {
    const hospital = hospitalForSlug(db(), slug);
    if (!hospital) return [];
    const q = normalizeArabic(query);
    if (q.length < 2) return [];
    const digits = normalizeDigits(query.trim());
    return db().staff
      .filter((s) => rowHospital(s) === hospital.id && s.is_active && (normalizeArabic(s.full_name).includes(q) || (s.his_user_id ?? "").includes(digits)))
      .slice(0, 10)
      .map(toLite);
  },

  async addStaffPublic(slug, input) {
    const d = db();
    const hospital = hospitalForSlug(d, slug);
    if (!hospital) throw new Error("invalid_hospital");
    const name = input.full_name.replace(/\s+/g, " ").trim();
    if (name.length < 3) throw new Error("invalid_name");
    const his = input.his_user_id?.trim() || null;
    const existing = d.staff.find((s) => rowHospital(s) === hospital.id && ((his && s.his_user_id === his) || sameName(s.full_name, name)));
    if (existing) return toLite(existing);
    const t = nowIso();
    const s: StaffMember = {
      id: newId(), hospital_id: hospital.id, full_name: name, job_type: input.job_type, department_id: null,
      his_user_id: his, legacy_status: null, legacy_status_reviewed: false, is_active: true,
      registration_status: "not_started", manual_score: 0, needs_review: true, created_at: t, updated_at: t,
      created_by: null, updated_by: null,
    };
    d.staff.push(s);
    audit(d, { action: "staff_added_from_form", entity_type: "staff_member", entity_id: s.id, new_values: { full_name: name } });
    save();
    return toLite(s);
  },

  async submitEvaluationPublic(slug, input: SubmitEvaluationInput): Promise<SubmitEvaluationResult> {
    const d = db();
    const hospital = hospitalForSlug(d, slug);
    if (!hospital) throw new Error("invalid_hospital");
    const staff = d.staff.find((s) => s.id === input.staffId && rowHospital(s) === hospital.id && s.is_active);
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

  async publicStatsPublic(slug): Promise<PublicStats> {
    const d = db();
    const hospital = hospitalForSlug(d, slug);
    const active = d.staff.filter((s) => (!hospital || rowHospital(s) === hospital.id) && s.is_active);
    const registered = active.filter((s) => s.registration_status === "registered").length;
    return {
      total: active.length,
      registered,
      pending: active.length - registered,
      review: active.filter((s) => s.manual_score <= ESCALATION_THRESHOLD).length,
    };
  },

  /* ---------------- hospitals ---------------- */

  async listHospitals() {
    return hospitalsOf(db()).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  },

  async createHospital(name) {
    const d = db();
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2) throw new Error("invalid_name");
    let slug = slugifyName(clean);
    const taken = new Set(hospitalsOf(d).map((h) => h.slug));
    for (let i = 2; taken.has(slug); i++) slug = `${slugifyName(clean)}-${i}`;
    const hospital: Hospital = { id: newId(), name: clean, slug, is_active: true, created_at: nowIso(), updated_at: nowIso() };
    hospitalsOf(d).push(hospital);
    audit(d, { action: "hospital_created", entity_type: "hospital", entity_id: hospital.id, new_values: { name: clean, slug } });
    save();
    return hospital;
  },

  async updateHospital(id, patch) {
    const d = db();
    const h = hospitalsOf(d).find((x) => x.id === id);
    if (!h) throw new Error("hospital_not_found");
    if (patch.name !== undefined) h.name = patch.name.replace(/\s+/g, " ").trim();
    if (patch.is_active !== undefined) h.is_active = patch.is_active;
    h.updated_at = nowIso();
    audit(d, { action: "hospital_updated", entity_type: "hospital", entity_id: id, new_values: { ...patch } });
    save();
  },

  /* ---------------- engineer accounts (demo) ---------------- */

  async listUsers(hospitalId) {
    const want = hospitalId !== undefined ? hospitalId : effectiveScope();
    return usersOf(db())
      .filter((u) => want === null || u.hospital_id === want)
      .map(toAccount);
  },

  async createUser(input: CreateUserInput) {
    const d = db();
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error("invalid_username");
    const name = input.full_name.replace(/\s+/g, " ").trim();
    if (name.length < 3) throw new Error("invalid_name");
    if (usersOf(d).some((u) => u.username === username)) throw new Error("duplicate_username");
    const password = randomPassword();
    const user: DemoUser = {
      id: newId(), username, full_name: name, job_title: input.job_title?.trim() || null, role: input.role,
      hospital_id: input.hospital_id, must_change_password: input.must_change_password, is_active: true,
      password, created_at: nowIso(),
    };
    usersOf(d).push(user);
    audit(d, { action: "user_created", entity_type: "profile", entity_id: user.id, new_values: { username, role: input.role } });
    save();
    return { user: toAccount(user), password };
  },

  async updateUser(id, patch: UpdateUserInput) {
    const d = db();
    const u = usersOf(d).find((x) => x.id === id);
    if (!u) throw new Error("user_not_found");
    const before = { full_name: u.full_name, job_title: u.job_title, role: u.role, is_active: u.is_active };
    if (patch.full_name !== undefined) u.full_name = patch.full_name.replace(/\s+/g, " ").trim();
    if (patch.job_title !== undefined) u.job_title = patch.job_title?.trim() || null;
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.is_active !== undefined) u.is_active = patch.is_active;
    audit(d, { action: "user_updated", entity_type: "profile", entity_id: id, previous_values: before, new_values: { ...patch } });
    save();
  },

  async resetUserPassword(id) {
    const d = db();
    const u = usersOf(d).find((x) => x.id === id);
    if (!u) throw new Error("user_not_found");
    const password = randomPassword();
    u.password = password;
    u.must_change_password = true;
    audit(d, { action: "password_reset", entity_type: "profile", entity_id: id, new_values: { reset: true } });
    save();
    return { password };
  },

  /* ---------------- staff ---------------- */

  async listStaff() {
    return staffInScope(db()).map(withDept).sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
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
      id: newId(), hospital_id: effectiveScope() ?? DEMO_MAIN_HOSPITAL_ID, full_name: input.full_name.replace(/\s+/g, " ").trim(),
      job_type: input.job_type, department_id: input.department_id ?? null, his_user_id: his,
      legacy_status: null, legacy_status_reviewed: false, is_active: true, registration_status: "not_started",
      manual_score: 0, needs_review: false, created_at: t, updated_at: t, created_by: "demo-admin", updated_by: "demo-admin",
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

  async clearEvaluations(id, reason) {
    const d = db();
    const s = d.staff.find((x) => x.id === id);
    if (!s) throw new Error("staff_not_found");
    const previous = s.manual_score;
    const before = d.evaluations.length;
    d.evaluations = d.evaluations.filter((e) => e.staff_member_id !== id);
    s.manual_score = 0;
    s.updated_at = nowIso();
    audit(d, { action: "evaluations_cleared", entity_type: "staff_member", entity_id: id, previous_values: { manual_score: previous, evaluations: before }, new_values: { manual_score: 0, evaluations: 0 }, reason: reason ?? null });
    save();
  },

  async listDepartments() {
    return DEMO_DEPARTMENTS;
  },

  async listEvaluations(opts) {
    let list = db().evaluations.filter((e) => inScope(staffHospital(db(), e.staff_member_id)));
    if (opts?.staffId) list = list.filter((e) => e.staff_member_id === opts.staffId);
    list = list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    return opts?.limit ? list.slice(0, opts.limit) : list;
  },

  async listFollowups(opts) {
    let list = db().followups.filter((f) => inScope(staffHospital(db(), f.staff_member_id)));
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
    let list = db().escalations.filter((e) => inScope(staffHospital(db(), e.staff_member_id)));
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
        id: newId(), hospital_id: effectiveScope() ?? DEMO_MAIN_HOSPITAL_ID, full_name: r.full_name, job_type: r.job_type,
        department_id: r.department_id ?? null, his_user_id: r.his_user_id, legacy_status: r.legacy_status,
        legacy_status_reviewed: false, is_active: true, registration_status: "not_started", manual_score: 0,
        needs_review: r.needs_review ?? false, created_at: t, updated_at: t, created_by: "demo-admin", updated_by: "demo-admin",
      });
      imported++;
    }
    audit(d, { action: "staff_import", entity_type: "import_job", entity_id: null, new_values: { file: _fileName, total: rows.length, imported, failed } });
    save();
    return { imported, failed };
  },

  /* ---------------- bed follow-up board ---------------- */

  async listBeds() {
    return bedsOf(db()).filter((b) => inScope(rowHospital(b))).slice().sort(compareBeds);
  },

  async createBed(input: BedInput) {
    const d = db();
    const beds = bedsOf(d);
    assertBedNo(input.bed_no);
    const location = normalizeLocation(input.location);
    if (beds.some((b) => bedKey(b.location, b.bed_no) === bedKey(location, input.bed_no))) throw new Error("duplicate_bed");
    const bed: BedRecord = {
      id: newId(), hospital_id: effectiveScope() ?? DEMO_MAIN_HOSPITAL_ID, location, bed_no: input.bed_no,
      owner_name: cleanText(input.owner_name), patient_name: cleanText(input.patient_name), notes: cleanText(input.notes),
      dr_edit_date: null, nurse_edit_date: null, tasks: {}, updated_at: nowIso(), updated_by_name: actorName(),
    };
    beds.push(bed);
    audit(d, { action: "bed_created", entity_type: "bed_followup", entity_id: bed.id, new_values: { location, bed_no: bed.bed_no } });
    save();
    return bed;
  },

  async updateBed(id, patch: BedPatch) {
    const d = db();
    const beds = bedsOf(d);
    const bed = beds.find((b) => b.id === id);
    if (!bed) throw new Error("bed_not_found");
    const location = patch.location === undefined ? bed.location : normalizeLocation(patch.location);
    const bed_no = patch.bed_no === undefined ? bed.bed_no : patch.bed_no;
    assertBedNo(bed_no);
    if (beds.some((b) => b.id !== id && bedKey(b.location, b.bed_no) === bedKey(location, bed_no))) throw new Error("duplicate_bed");
    bed.location = location;
    bed.bed_no = bed_no;
    if (patch.owner_name !== undefined) bed.owner_name = cleanText(patch.owner_name);
    if (patch.patient_name !== undefined) bed.patient_name = cleanText(patch.patient_name);
    if (patch.notes !== undefined) bed.notes = cleanText(patch.notes);
    if (patch.dr_edit_date !== undefined) bed.dr_edit_date = validDate(patch.dr_edit_date);
    if (patch.nurse_edit_date !== undefined) bed.nurse_edit_date = validDate(patch.nurse_edit_date);
    bed.updated_at = nowIso();
    bed.updated_by_name = actorName();
    save();
  },

  async setBedTasks(id, patch) {
    const bed = bedsOf(db()).find((b) => b.id === id);
    if (!bed) throw new Error("bed_not_found");
    for (const [k, v] of Object.entries(patch)) {
      if (!/^[a-z_]{1,32}$/.test(k) || typeof v !== "boolean") throw new Error("invalid_tasks");
    }
    bed.tasks = { ...bed.tasks, ...patch };
    bed.updated_at = nowIso();
    bed.updated_by_name = actorName();
    save();
  },

  async dischargeBed(id) {
    const d = db();
    const bed = bedsOf(d).find((b) => b.id === id);
    if (!bed) throw new Error("bed_not_found");
    bed.patient_name = "";
    bed.notes = "";
    bed.dr_edit_date = null;
    bed.nurse_edit_date = null;
    bed.tasks = {};
    bed.updated_at = nowIso();
    bed.updated_by_name = actorName();
    // the audit trail records which bed was cleared, never the patient's name
    audit(d, { action: "bed_discharged", entity_type: "bed_followup", entity_id: id, new_values: { location: bed.location, bed_no: bed.bed_no } });
    save();
  },

  async deleteBed(id) {
    const d = db();
    const beds = bedsOf(d);
    const i = beds.findIndex((b) => b.id === id);
    if (i < 0) throw new Error("bed_not_found");
    const [bed] = beds.splice(i, 1);
    audit(d, { action: "bed_deleted", entity_type: "bed_followup", entity_id: id, new_values: { location: bed.location, bed_no: bed.bed_no } });
    save();
  },

  async importBeds(rows: BedImportRow[], fileName: string): Promise<BedImportResult> {
    const d = db();
    const beds = bedsOf(d);
    const byKey = new Map(beds.map((b) => [bedKey(b.location, b.bed_no), b]));
    let created = 0;
    let updated = 0;
    const t = nowIso();
    const by = actorName();
    const hospitalId = effectiveScope() ?? DEMO_MAIN_HOSPITAL_ID;
    for (const r of rows) {
      const existing = byKey.get(bedKey(r.location, r.bed_no));
      if (existing) {
        Object.assign(existing, {
          owner_name: r.owner_name, patient_name: r.patient_name, notes: r.notes,
          dr_edit_date: r.dr_edit_date, nurse_edit_date: r.nurse_edit_date, tasks: { ...r.tasks },
          updated_at: t, updated_by_name: by,
        });
        updated++;
      } else {
        const bed: BedRecord = { id: newId(), hospital_id: hospitalId, ...r, tasks: { ...r.tasks }, updated_at: t, updated_by_name: by };
        beds.push(bed);
        byKey.set(bedKey(bed.location, bed.bed_no), bed);
        created++;
      }
    }
    audit(d, { action: "beds_import", entity_type: "import_job", entity_id: null, new_values: { file: fileName, total: rows.length, created, updated } });
    save();
    return { created, updated, failed: 0 };
  },
};

/* ------------------------------------------------------------------ */
/* Demo sign-in with admin-created accounts                            */
/* ------------------------------------------------------------------ */

/** The signed-in demo account (same shape as the admin screens' UserAccount). */
export type DemoSessionUser = UserAccount;

/** Returns the demo account matching the session (null = not signed in). */
export function readDemoSessionUser(): DemoUser | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { username: string };
    const u = usersOf(db()).find((x) => x.username === session.username && x.is_active);
    return u ?? null;
  } catch {
    return null;
  }
}

/**
 * Signs in with a username + password against the demo accounts in localStorage.
 * Legacy env credentials (teamhis / adminhis@@@) keep working through the seeded user.
 */
export function demoUserLogin(username: string, password: string): boolean {
  try {
    const clean = username.trim().toLowerCase();
    const u = usersOf(db()).find((x) => x.username === clean && x.is_active && x.password === password);
    if (!u) return false;
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ username: u.username, name: u.full_name } satisfies { username: string; name: string }));
    return true;
  } catch {
    return false;
  }
}

/** Marks the forced password change as done after the demo user changes their password. */
export function clearDemoMustChangePassword(id: string, newPassword: string) {
  const u = usersOf(db()).find((x) => x.id === id);
  if (!u) return;
  u.must_change_password = false;
  u.password = newPassword;
  save();
}
