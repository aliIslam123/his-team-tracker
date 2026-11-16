import { normalizeArabic, normalizeDigits } from "@/lib/evaluation";
import type { BedImportRow, BedRecord } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* The task list — the ONLY place that defines the sheet's columns.    */
/* Add / reorder / relabel / move a task between groups here; the      */
/* database stores tasks as a free { key: boolean } map so no          */
/* migration is needed. Never rename a `key` once real data exists.    */
/* ------------------------------------------------------------------ */

export type TaskGroup = "doctor" | "nurse";

export interface BedTaskDef {
  /** Stored in the database. Lowercase letters and underscores only (max 32). */
  key: string;
  /** Column title in the UI and in the Excel export. */
  label: string;
  group: TaskGroup;
  /** Other header spellings accepted when importing the old sheet. */
  aliases?: string[];
}

export const BED_TASKS: BedTaskDef[] = [
  { key: "diagnosis", label: "Diagnosis", group: "doctor" },
  { key: "complaints", label: "Complaints", group: "doctor" },
  { key: "procedures", label: "Procedures", group: "doctor" },
  { key: "medicine", label: "Medicine", group: "doctor" },
  { key: "oxygen_chest", label: "Oxygen/Chest", group: "doctor", aliases: ["oxgen chest", "oxygen chest", "oxygen", "oxgen"] },
  { key: "feeding", label: "Feeding", group: "doctor" },
  { key: "apache", label: "APACHE", group: "doctor" },
  { key: "lab", label: "Lab", group: "doctor", aliases: ["labs"] },
  { key: "vitals", label: "Vitals", group: "nurse" },
  { key: "initial", label: "Initial", group: "nurse", aliases: ["intial"] },
  { key: "daily", label: "Daily", group: "nurse" },
  { key: "fluid", label: "Fluid", group: "nurse" },
  { key: "turning", label: "Turning", group: "nurse" },
  { key: "invasive", label: "Invasive", group: "nurse" },
];

/** A last-edit date this many days old (or more) is shown as stale. */
export const STALE_DAYS = 2;

export const tasksOf = (group: TaskGroup): BedTaskDef[] => BED_TASKS.filter((t) => t.group === group);

/* ------------------------------------------------------------------ */
/* Progress / staleness                                                */
/* ------------------------------------------------------------------ */

export function groupProgress(bed: Pick<BedRecord, "tasks">, group: TaskGroup): { done: number; total: number } {
  const defs = tasksOf(group);
  return { done: defs.filter((d) => bed.tasks[d.key]).length, total: defs.length };
}

export const isGroupComplete = (bed: Pick<BedRecord, "tasks">, group: TaskGroup) => {
  const p = groupProgress(bed, group);
  return p.total > 0 && p.done === p.total;
};

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Whole days between `iso` and `today` (both YYYY-MM-DD). null when there is no date. */
export function dateAgeDays(iso: string | null | undefined, today: string): number | null {
  return iso ? dayNumber(today) - dayNumber(iso) : null;
}

export type DateTone = "none" | "today" | "recent" | "stale";

export function dateTone(iso: string | null | undefined, today: string): DateTone {
  const age = dateAgeDays(iso, today);
  if (age === null) return "none";
  if (age <= 0) return "today";
  return age < STALE_DAYS ? "recent" : "stale";
}

export const isBedStale = (bed: Pick<BedRecord, "dr_edit_date" | "nurse_edit_date">, today: string) =>
  dateTone(bed.dr_edit_date, today) === "stale" || dateTone(bed.nurse_edit_date, today) === "stale";

export type BedStatusFilter = "all" | "incomplete" | "doctor_incomplete" | "nurse_incomplete" | "complete" | "stale";
export const BED_STATUS_FILTERS: BedStatusFilter[] = ["all", "incomplete", "doctor_incomplete", "nurse_incomplete", "complete", "stale"];

export function matchesStatus(bed: BedRecord, status: BedStatusFilter, today: string): boolean {
  const dr = isGroupComplete(bed, "doctor");
  const nu = isGroupComplete(bed, "nurse");
  switch (status) {
    case "incomplete": return !dr || !nu;
    case "doctor_incomplete": return !dr;
    case "nurse_incomplete": return !nu;
    case "complete": return dr && nu;
    case "stale": return isBedStale(bed, today);
    default: return true;
  }
}

export const compareBeds = (a: Pick<BedRecord, "bed_no" | "location">, b: Pick<BedRecord, "bed_no" | "location">) =>
  a.bed_no - b.bed_no || a.location.localeCompare(b.location, "en", { numeric: true });

/** Stable colour per owner (the old sheet coloured each owner's rows). */
export function ownerHue(name: string): number {
  let h = 0;
  for (const ch of name.trim()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}

/* ------------------------------------------------------------------ */
/* Text cleanup                                                        */
/* ------------------------------------------------------------------ */

export const cleanText = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/** "hall  3" → "Hall 3", "ROOM14" → "Room 14"; anything else is just trimmed. */
export function normalizeLocation(v: unknown): string {
  const s = cleanText(v);
  const m = /^(hall|room)\s*(\d+)$/i.exec(s);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : s;
}

/* ------------------------------------------------------------------ */
/* Export (same column order as the old sheet, so it can round-trip)   */
/* ------------------------------------------------------------------ */

export function bedsToExportRows(beds: BedRecord[]): Record<string, unknown>[] {
  const done = (b: BedRecord, key: string) => (b.tasks[key] ? "DONE" : "");
  return beds.map((b) => {
    const row: Record<string, unknown> = {
      Location: b.location,
      "المسؤول": b.owner_name,
      "Bed No": b.bed_no,
      "Patient Name": b.patient_name,
      Notes: b.notes,
      "edit dr.date": b.dr_edit_date ?? "",
    };
    for (const t of tasksOf("doctor")) row[t.label] = done(b, t.key);
    row["edit nurse.date"] = b.nurse_edit_date ?? "";
    for (const t of tasksOf("nurse")) row[t.label] = done(b, t.key);
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Import from the old sheet (pure functions: no DOM, easy to test)    */
/* ------------------------------------------------------------------ */

/** Letters and digits only, Arabic-normalised, lowercase — so "Bed No", "bed_no" and "BED-NO" all match. */
const squash = (s: unknown) => normalizeArabic(String(s ?? "")).replace(/[^\p{L}\p{N}]/gu, "");

type Field = "location" | "owner" | "bed" | "patient" | "notes" | "dr_date" | "nurse_date" | `task:${string}`;

const FIELD_NAMES: Record<Exclude<Field, `task:${string}`>, string[]> = {
  location: ["location", "loc", "hall", "الموقع", "المكان", "القاعة"],
  owner: ["owner", "responsible", "مسؤول", "المسؤول", "مسوؤل"],
  bed: ["bed no", "bed", "bed number", "رقم السرير", "السرير"],
  patient: ["patient name", "patient", "name", "اسم المريض", "المريض", "الاسم"],
  notes: ["notes", "note", "ملاحظات"],
  dr_date: ["edit dr.date", "dr date", "doctor date", "doctor edit date"],
  nurse_date: ["edit nurse.date", "nurse date", "nurse edit date"],
};

const HEADER_TO_FIELD: Map<string, Field> = (() => {
  const m = new Map<string, Field>();
  for (const [field, names] of Object.entries(FIELD_NAMES)) for (const n of names) m.set(squash(n), field as Field);
  for (const t of BED_TASKS) for (const n of [t.key, t.label, ...(t.aliases ?? [])]) m.set(squash(n), `task:${t.key}`);
  return m;
})();

const DONE_WORDS = new Set(["done", "تم", "yes", "y", "true", "1", "✓", "✔"]);

export function isDoneCell(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  return DONE_WORDS.has(cleanText(v).toLowerCase());
}

/** Accepts Excel serial numbers, Date objects, "2026-11-15" and Egyptian-style "15/11/2026". Returns YYYY-MM-DD or null. */
export function parseSheetDate(v: unknown): string | null {
  const iso = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    if (v < 20_000 || v > 80_000) return null;
    const d = new Date(Math.round((v - 25_569) * 86_400_000)); // 25569 = days from 1899-12-30 to 1970-01-01
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = normalizeDigits(cleanText(v));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

function parseBedNo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseInt(normalizeDigits(cleanText(v)), 10);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n) : null;
}

export interface BedSheetParse {
  rows: BedImportRow[];
  /** Rows that had content but no usable bed number. */
  skipped: number;
  /** Same location + bed number twice in the file (the later row wins). */
  duplicates: number;
  error?: "no_header";
}

/** `grid` is the sheet as an array of rows (e.g. XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })). */
export function parseBedSheet(grid: unknown[][]): BedSheetParse {
  const empty = (error?: "no_header"): BedSheetParse => ({ rows: [], skipped: 0, duplicates: 0, error });

  // 1) find the header row (within the first 10 rows): it must contain a "bed" column
  let headerIdx = -1;
  let cols = new Map<Field, number>();
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const found = new Map<Field, number>();
    (grid[r] ?? []).forEach((cell, c) => {
      const f = HEADER_TO_FIELD.get(squash(cell));
      if (f && !found.has(f)) found.set(f, c);
    });
    if (found.has("bed") && found.size >= 3) { headerIdx = r; cols = found; break; }
  }
  if (headerIdx < 0) return empty("no_header");

  // 2) the old sheet's first two headers are garbled ("ئ", "مسوؤل"): fall back to their position
  const headerRow = grid[headerIdx] ?? [];
  const unknownAt = (c: number) => c < headerRow.length && cleanText(headerRow[c]) !== "" && !HEADER_TO_FIELD.has(squash(headerRow[c]));
  if (!cols.has("location") && unknownAt(0)) cols.set("location", 0);
  if (!cols.has("owner") && unknownAt(1) && ![...cols.values()].includes(1)) cols.set("owner", 1);

  // 3) read the data rows
  const byKey = new Map<string, BedImportRow>();
  let skipped = 0;
  let duplicates = 0;
  const at = (row: unknown[], f: Field) => (cols.has(f) ? row[cols.get(f)!] : undefined);

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (!row.some((c) => cleanText(c) !== "")) continue; // blank separator line
    const bed_no = parseBedNo(at(row, "bed"));
    if (bed_no === null) { skipped++; continue; }

    const tasks: Record<string, boolean> = {};
    for (const t of BED_TASKS) if (isDoneCell(at(row, `task:${t.key}`))) tasks[t.key] = true;

    const rec: BedImportRow = {
      location: normalizeLocation(at(row, "location")),
      bed_no,
      owner_name: cleanText(at(row, "owner")),
      patient_name: cleanText(at(row, "patient")),
      notes: cleanText(at(row, "notes")),
      dr_edit_date: parseSheetDate(at(row, "dr_date")),
      nurse_edit_date: parseSheetDate(at(row, "nurse_date")),
      tasks,
    };
    const key = `${rec.location.toLowerCase()}|${rec.bed_no}`;
    if (byKey.has(key)) duplicates++;
    byKey.set(key, rec);
  }
  return { rows: [...byKey.values()].sort(compareBeds), skipped, duplicates };
}
