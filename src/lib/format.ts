import type { Lang } from "@/lib/i18n";

function locale(lang: Lang) {
  // Latin digits in both languages so numbers read consistently across the UI.
  return lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
}

export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(locale(lang), { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "-";
  try {
    // date-only strings (YYYY-MM-DD) are parsed as UTC; pin them to noon to avoid off-by-one in local time
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
    return d.toLocaleDateString(locale(lang), { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

/** Today's date as YYYY-MM-DD in the user's local time zone. */
export function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}
