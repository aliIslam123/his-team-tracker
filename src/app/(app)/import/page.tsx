"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading, PageHeader } from "@/components/shared";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { getRepo } from "@/lib/repo";
import { normalizeArabic } from "@/lib/evaluation";
import { JOB_TYPES } from "@/lib/validations";
import { errorKey } from "@/lib/errors";
import type { Department, ImportRowInput, JobType, StaffMember } from "@/lib/types";

/* ---------- header classification ---------- */

// Columns holding secrets / personal identifiers are never read, whatever the file contains.
const SENSITIVE_PHRASES = ["national id", "الرقم القومي", "رقم قومي", "كلمة المرور", "كلمة السر", "p.s", "الرقم السري"].map(normalizeArabic);
const SENSITIVE_TOKENS = new Set(
  ["pin", "password", "pass", "passwd", "ps", "phone", "mobile", "tel", "email", "mail", "salary", "address", "nid", "ssn", "passport",
   "هاتف", "الهاتف", "موبايل", "تليفون", "الراتب", "مرتب", "عنوان", "العنوان", "بريد", "ايميل", "الايميل"].map(normalizeArabic)
);

function isSensitiveHeader(h: string): boolean {
  const n = normalizeArabic(h);
  if (SENSITIVE_PHRASES.some((p) => n.includes(p))) return true;
  return n.split(/[^a-z0-9\u0600-\u06ff]+/).filter(Boolean).some((tok) => SENSITIVE_TOKENS.has(tok));
}

type Field = "full_name" | "job_type" | "his_user_id" | "legacy_status" | "department" | null;

function mapHeader(h: string): Field {
  const n = normalizeArabic(h);
  const toks = n.split(/[^a-z0-9\u0600-\u06ff]+/).filter(Boolean);
  if (toks.includes("his") || /user ?id|user_id|userid|employee ?id|id ?الموظف|الموظف ?id|الرقم الوظيفي|معرف|كود/.test(n)) return "his_user_id";
  if (/department|\bdept\b|قسم/.test(n)) return "department";
  if (/legacy|status|حاله/.test(n)) return "legacy_status";
  if (/job|type|وظيفه/.test(n)) return "job_type";
  if (/name|اسم/.test(n)) return "full_name";
  return null;
}

function normalizeJobType(v: string): JobType | null {
  const n = normalizeArabic(v);
  if (!n) return null;
  const direct = JOB_TYPES.find((j) => j.toLowerCase() === n);
  if (direct) return direct;
  if (/specialist|اخصايي|اخصائي|استشاري/.test(n)) return "Specialist Doctor";
  if (/(head|رئيس|مشرف)/.test(n) && /(nurs|ممرض|تمريض)/.test(n)) return "Head Nurse";
  if (/nurs|ممرض|تمريض/.test(n)) return "Nurse";
  if (/doctor|\bdr\b|طبيب|دكتور/.test(n)) return "Doctor";
  if (/admin|اداري|اداره|سكرتير/.test(n)) return "Administration";
  return null;
}

/** Drops values that look like ID numbers or stray punctuation (the old data had a national-ID-like value here). */
function cleanLegacy(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if ((s.match(/\d/g) ?? []).length >= 6) return null;
  if (!/[A-Za-z\u0600-\u06FF]/.test(s)) return null;
  return s.slice(0, 60);
}

/* ---------- row model ---------- */

type RowStatus = "new" | "possible" | "duplicate" | "invalid";

interface ParsedRow {
  full_name: string;
  job_type: JobType | null;
  his_user_id: string | null;
  legacy_status: string | null;
  department_id: string | null;
  status: RowStatus;
  issue?: string;
}

interface Parsed {
  fileName: string;
  rows: ParsedRow[];
  ignoredColumns: string[];
}

export default function ImportPage() {
  const { t } = useLanguage();
  const allowed = useRequirePermission("staff.import");
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [includePossible, setIncludePossible] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!allowed) return <Loading />;

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let json: Record<string, unknown>[] = [];
      if (ext === "csv") {
        const text = (await file.text()).replace(/^\uFEFF/, "");
        json = Papa.parse(text, { header: true, skipEmptyLines: true }).data as Record<string, unknown>[];
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer());
        json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      }
      if (!json.length) { toast.error(t("import_empty")); return; }

      const headers = Object.keys(json[0]);
      const ignoredColumns = headers.filter(isSensitiveHeader);
      const fieldOf: Record<string, Field> = {};
      for (const h of headers) fieldOf[h] = isSensitiveHeader(h) ? null : mapHeader(h);
      if (!Object.values(fieldOf).includes("full_name")) { toast.error(t("import_no_name_column")); return; }

      const repo = getRepo();
      const [existing, departments]: [StaffMember[], Department[]] = await Promise.all([repo.listStaff(), repo.listDepartments()]);
      const byHis = new Set(existing.map((s) => s.his_user_id).filter(Boolean) as string[]);
      const byName = new Set(existing.map((s) => normalizeArabic(s.full_name)));
      const deptByName = new Map<string, string>();
      for (const d of departments) { deptByName.set(normalizeArabic(d.name_ar), d.id); deptByName.set(normalizeArabic(d.name_en), d.id); }

      const rows: ParsedRow[] = json.map((r) => {
        const o = { full_name: "", job: "", his: "", legacy: "", dept: "" };
        for (const h of headers) {
          const f = fieldOf[h];
          const val = String(r[h] ?? "").replace(/\s+/g, " ").trim();
          if (f === "full_name") o.full_name = val;
          else if (f === "job_type") o.job = val;
          else if (f === "his_user_id") o.his = val;
          else if (f === "legacy_status") o.legacy = val;
          else if (f === "department") o.dept = val;
        }
        const job = normalizeJobType(o.job);
        const row: ParsedRow = {
          full_name: o.full_name,
          job_type: job,
          his_user_id: o.his || null,
          legacy_status: cleanLegacy(o.legacy),
          department_id: o.dept ? deptByName.get(normalizeArabic(o.dept)) ?? null : null,
          status: "new",
        };
        if (o.full_name.length < 3) return { ...row, status: "invalid", issue: t("import_err_name") };
        if (!job) return { ...row, status: "invalid", issue: t("import_err_job") };

        const nn = normalizeArabic(o.full_name);
        if (row.his_user_id && byHis.has(row.his_user_id)) return { ...row, status: "duplicate", issue: t("import_dup_his") };
        if (!row.his_user_id && byName.has(nn)) return { ...row, status: "duplicate", issue: t("import_dup_name") };
        if (row.his_user_id && byName.has(nn)) {
          row.status = "possible";
          row.issue = t("import_possible_name");
        }

        // later rows in the same file are checked against earlier ones too
        if (row.his_user_id) byHis.add(row.his_user_id);
        byName.add(nn);
        return row;
      });

      setParsed({ fileName: file.name, rows, ignoredColumns });
    } catch {
      toast.error(t("import_read_error"));
    } finally {
      setParsing(false);
    }
  };

  const counts = parsed
    ? {
        total: parsed.rows.length,
        fresh: parsed.rows.filter((r) => r.status === "new").length,
        possible: parsed.rows.filter((r) => r.status === "possible").length,
        duplicate: parsed.rows.filter((r) => r.status === "duplicate").length,
        invalid: parsed.rows.filter((r) => r.status === "invalid").length,
      }
    : null;
  const toImport = parsed ? parsed.rows.filter((r) => r.status === "new" || (includePossible && r.status === "possible")) : [];

  const confirmImport = async () => {
    if (!parsed || toImport.length === 0) return;
    setImporting(true);
    try {
      const payload: ImportRowInput[] = toImport.map((r) => ({
        full_name: r.full_name,
        job_type: r.job_type as JobType,
        his_user_id: r.his_user_id,
        legacy_status: r.legacy_status,
        department_id: r.department_id,
        needs_review: r.status === "possible",
      }));
      const res = await getRepo().importStaff(payload, parsed.fileName);
      toast.success(`${t("imported_successfully")}: ${res.imported}${res.failed ? ` · ${t("invalid_row")}: ${res.failed}` : ""}`);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImporting(false);
    }
  };

  const badge = (s: RowStatus) =>
    s === "new" ? <Badge variant="success">{t("import_status_new")}</Badge>
    : s === "possible" ? <Badge variant="warning">{t("import_status_possible")}</Badge>
    : s === "duplicate" ? <Badge variant="secondary">{t("duplicate_detected")}</Badge>
    : <Badge variant="destructive">{t("invalid_row")}</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("import_title")} actions={<a href="/staff_template.csv" download><Button variant="outline">{t("download_template")}</Button></a>} />
      <Card>
        <CardHeader><CardTitle>{t("import_upload")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" aria-label={t("import_upload")} disabled={parsing || importing}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <p className="text-xs text-muted-foreground">{t("import_help")}</p>
          <p className="text-xs text-muted-foreground">{t("import_sensitive_note")}</p>
        </CardContent>
      </Card>

      {parsing && <Loading />}

      {parsed && counts && (
        <>
          <Card>
            <CardHeader><CardTitle>{t("import_summary")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge>{t("total")}: {counts.total}</Badge>
                <Badge variant="success">{t("import_status_new")}: {counts.fresh}</Badge>
                <Badge variant="warning">{t("import_status_possible")}: {counts.possible}</Badge>
                <Badge variant="secondary">{t("duplicate_detected")}: {counts.duplicate}</Badge>
                <Badge variant="destructive">{t("invalid_row")}: {counts.invalid}</Badge>
              </div>
              {parsed.ignoredColumns.length > 0 && (
                <p className="text-xs text-warning">{t("import_ignored_columns")}: {parsed.ignoredColumns.join("، ")}</p>
              )}
              {counts.possible > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={includePossible} onChange={(e) => setIncludePossible(e.target.checked)} />
                  {t("import_include_possible")}
                </label>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("import_preview")}</CardTitle></CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-muted-foreground">
                      <th className="p-2 text-start">{t("full_name")}</th>
                      <th className="p-2 text-start">{t("job_type")}</th>
                      <th className="p-2 text-start">{t("his_user_id")}</th>
                      <th className="p-2 text-start">{t("legacy_status")}</th>
                      <th className="p-2 text-start">{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 300).map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{r.full_name}</td>
                        <td className="p-2">{r.job_type ?? "-"}</td>
                        <td className="p-2" dir="ltr">{r.his_user_id ?? "-"}</td>
                        <td className="p-2">{r.legacy_status ?? "-"}</td>
                        <td className="p-2">{badge(r.status)}{r.issue && <span className="ms-2 text-xs text-muted-foreground">{r.issue}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > 300 && <p className="pt-2 text-xs text-muted-foreground">{t("import_preview_limited")}</p>}
              <div className="mt-4 flex gap-2">
                <Button onClick={confirmImport} disabled={importing || toImport.length === 0}>
                  {importing ? t("loading") : `${t("import_confirm")} (${toImport.length})`}
                </Button>
                <Button variant="outline" onClick={() => { setParsed(null); if (fileRef.current) fileRef.current.value = ""; }} disabled={importing}>{t("cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
