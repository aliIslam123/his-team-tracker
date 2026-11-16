import type { Lang } from "@/lib/i18n";

export type EvalGroup = "positive" | "negative" | "neutral";

export interface EvalOption {
  id: string;
  group: EvalGroup;
  points: number;
  ar: string;
  en: string;
}

/**
 * Single source of truth for evaluation outcomes.
 * The same ids and points are enforced server-side by the `submit_evaluation`
 * SQL function (supabase/migrations/0002_integration.sql) — keep both in sync.
 */
export const EVAL_OPTIONS: EvalOption[] = [
  { id: "registered", group: "positive", points: 1, ar: "تم التسجيل بنجاح", en: "Successfully registered" },
  { id: "cooperated", group: "positive", points: 1, ar: "تعاون مع الفريق", en: "Cooperated with the team" },
  { id: "accepted_training", group: "positive", points: 1, ar: "قبل التدريب والشرح", en: "Accepted training and system explanation" },
  { id: "completed_steps", group: "positive", points: 1, ar: "أكمل الخطوات المطلوبة", en: "Completed the required steps" },

  { id: "refused", group: "negative", points: -1, ar: "رفض التسجيل", en: "Refused to register" },
  { id: "busy_refused", group: "negative", points: -1, ar: "قال مشغول ورفض تحديد وقت", en: "Said busy and refused to schedule" },
  { id: "postponed", group: "negative", points: -1, ar: "أجل مرارًا بدون سبب واضح", en: "Repeatedly postponed without clear reason" },
  { id: "refused_assistance", group: "negative", points: -1, ar: "رفض المساعدة رغم توفر الدعم", en: "Refused assistance despite support" },
  { id: "left_incomplete", group: "negative", points: -1, ar: "غادر دون إكمال رغم توفر المساعدة", en: "Left without completing despite assistance" },

  { id: "busy_medical", group: "neutral", points: 0, ar: "مشغول بواجبات طبية", en: "Busy with medical duties" },
  { id: "emergency", group: "neutral", points: 0, ar: "حالة طارئة/رعاية مرضى", en: "Emergency or urgent patient care" },
  { id: "not_available", group: "neutral", points: 0, ar: "غير متاح أثناء الزيارة", en: "Not available during visit" },
  { id: "system_problem", group: "neutral", points: 0, ar: "مشكلة في النظام/الإنترنت", en: "System or internet problem" },
  { id: "requested_appointment", group: "neutral", points: 0, ar: "طلب موعد آخر", en: "Requested another appointment" },
  { id: "admin_delay", group: "neutral", points: 0, ar: "تأخير إداري", en: "Administrative delay" },
  { id: "other", group: "neutral", points: 0, ar: "سبب مشروع آخر", en: "Other legitimate reason" },
];

/** A staff member whose net score reaches this value (or lower) is flagged for escalation. */
export const ESCALATION_THRESHOLD = -3;

export const OPEN_ESCALATION_STATUSES = ["draft", "pending_review", "returned"] as const;

export function getOption(id: string): EvalOption | undefined {
  return EVAL_OPTIONS.find((o) => o.id === id);
}

export function pointsFor(id: string): number {
  return getOption(id)?.points ?? 0;
}

export function resultLabel(id: string, lang: Lang): string {
  const o = getOption(id);
  if (!o) return id;
  return lang === "ar" ? o.ar : o.en;
}

export function groupForPoints(points: number): EvalGroup {
  return points > 0 ? "positive" : points < 0 ? "negative" : "neutral";
}

/* ------------------------------------------------------------------ */
/* Text helpers (Arabic-friendly search + phone handling)              */
/* ------------------------------------------------------------------ */

/** Convert Arabic-Indic and Persian digits to ASCII digits. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalises Arabic text for forgiving search: strips diacritics and unifies
 * alef/yaa/taa-marbuta variants. Mirrored by `translate(...)` in search_staff().
 */
export function normalizeArabic(s: string): string {
  return normalizeDigits(s)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns an Egyptian mobile number in local format (01XXXXXXXXX) when valid, otherwise null. */
export function normalizeEgyptPhone(input: string): string | null {
  let p = normalizeDigits(input).replace(/[\s\-().]/g, "");
  const m = p.match(/^(?:\+?20|0020)(1[0125]\d{8})$/);
  if (m) p = "0" + m[1];
  return /^01[0125]\d{8}$/.test(p) ? p : null;
}
