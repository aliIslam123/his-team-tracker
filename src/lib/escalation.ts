import type { Lang } from "@/lib/i18n";
import type { EvaluationRecord, StaffMember } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { resultLabel } from "@/lib/evaluation";

/**
 * Builds the formal escalation letter for a staff member from their documented evaluations.
 * Only negative evaluations are cited; if there are none, all evaluations are used.
 */
export function buildEscalationLetter(p: { staff: StaffMember; evaluations: EvaluationRecord[]; lang: Lang }): string {
  const { staff, lang } = p;
  const dept = staff.department?.name_ar || staff.department?.name_en || "";
  const negatives = p.evaluations.filter((e) => e.points < 0);
  const basis = (negatives.length ? negatives : p.evaluations)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const lines = basis.map((e) => `- ${formatDate(e.created_at, lang)}: ${resultLabel(e.result, lang)}${e.notes ? ` (${e.notes})` : ""}`);
  const list = lines.length ? lines.join("\n") : lang === "ar" ? "- لا توجد محاولات موثقة." : "- No documented attempts.";

  if (lang === "ar") {
    return [
      "السيد الأستاذ / [اسم المدير المختص]",
      "تحية طيبة وبعد،",
      "",
      `نحيط سيادتكم علمًا بأنه في إطار جهود فريق دعم وتفعيل نظام المعلومات الصحية (HIS)، تم إجراء عدة محاولات لمساعدة السيد/ة ${staff.full_name}، بوظيفة ${staff.job_type}${dept ? `، بقسم ${dept}` : ""}، لاستكمال إجراءات التسجيل على النظام.`,
      "",
      `وقد قدّم الفريق الدعم اللازم، وبلغ صافي نقاط التقييم ${staff.manual_score}، وفق المحاولات الموثقة التالية:`,
      list,
      "",
      "نرجو من سيادتكم التكرم بمراجعة الحالة والتوجيه بما ترونه مناسبًا لاستكمال إجراءات التسجيل.",
      "",
      "وتفضلوا بقبول فائق الاحترام والتقدير.",
      "",
      "فريق دعم وتفعيل نظام HIS",
    ].join("\n");
  }
  return [
    "Dear [Responsible Manager],",
    "",
    `As part of the HIS (Health Information System) activation effort, the support team made several attempts to help ${staff.full_name} (${staff.job_type}${dept ? `, ${dept}` : ""}) complete registration on the system.`,
    "",
    `The team provided the required support; the net evaluation score is ${staff.manual_score}, based on the following documented attempts:`,
    list,
    "",
    "We kindly ask you to review the case and advise on the appropriate next step to complete the registration.",
    "",
    "Respectfully,",
    "HIS Support & Activation Team",
  ].join("\n");
}
