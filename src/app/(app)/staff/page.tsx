"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, Plus, Search } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, PageHeader, RegistrationBadge, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { ESCALATION_THRESHOLD, normalizeArabic, normalizeDigits } from "@/lib/evaluation";
import { downloadXlsx } from "@/lib/export";
import { errorKey } from "@/lib/errors";
import { JOB_TYPES } from "@/lib/validations";
import type { StaffMember } from "@/lib/types";

const PAGE_SIZE = 50;
const STATUS_FILTERS = ["all", "registered", "pending", "positive", "negative", "review", "needs_verification", "inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function matchesFilter(s: StaffMember, f: StatusFilter): boolean {
  switch (f) {
    case "registered": return s.is_active && s.registration_status === "registered";
    case "pending": return s.is_active && s.registration_status !== "registered";
    case "positive": return s.is_active && s.manual_score > 0;
    case "negative": return s.is_active && s.manual_score < 0;
    case "review": return s.is_active && s.manual_score <= ESCALATION_THRESHOLD;
    case "needs_verification": return !!s.needs_review;
    case "inactive": return !s.is_active;
    default: return s.is_active;
  }
}

export default function StaffPage() {
  const { t, lang } = useLanguage();
  const { canManage } = useUser();
  const [q, setQ] = useState("");
  const [job, setJob] = useState("all");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null);
  const [clearTarget, setClearTarget] = useState<StaffMember | null>(null);
  const [resetReason, setResetReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useLoad(async () => {
    const repo = getRepo();
    const [staff, departments] = await Promise.all([repo.listStaff(), repo.listDepartments()]);
    return { staff, departments };
  });

  // dashboard cards link here with ?filter=review etc.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("filter");
    if (f && (STATUS_FILTERS as readonly string[]).includes(f)) setStatus(f as StatusFilter);
  }, []);

  useEffect(() => { setPage(0); }, [q, job, dept, status]);

  const filtered = useMemo(() => {
    const nq = normalizeArabic(q);
    const digits = normalizeDigits(q.trim());
    return (data?.staff ?? []).filter((s) => {
      if (!matchesFilter(s, status)) return false;
      if (job !== "all" && s.job_type !== job) return false;
      if (dept !== "all" && s.department_id !== dept) return false;
      if (!nq) return true;
      return normalizeArabic(s.full_name).includes(nq) || (s.his_user_id ?? "").includes(digits);
    });
  }, [data, q, job, dept, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const doReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      await getRepo().resetScore(resetTarget.id, resetReason.trim() || undefined);
      toast.success(t("success"));
      setResetTarget(null);
      setResetReason("");
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (!clearTarget) return;
    setBusy(true);
    try {
      await getRepo().clearEvaluations(clearTarget.id, resetReason.trim() || undefined);
      toast.success(t("success"));
      setClearTarget(null);
      setResetReason("");
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const exportXlsx = () =>
    downloadXlsx("staff.xlsx", "Staff", filtered.map((s) => ({
      [t("full_name")]: s.full_name,
      [t("job_type")]: s.job_type,
      [t("department")]: (lang === "ar" ? s.department?.name_ar : s.department?.name_en) ?? "",
      [t("his_user_id")]: s.his_user_id ?? "",
      [t("status")]: t(`reg_${s.registration_status}`),
      [t("score")]: s.manual_score,
    })));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("staff_directory")}
        description={data ? `${filtered.length} / ${data.staff.length}` : undefined}
        actions={
          <>
            <Button variant="outline" onClick={exportXlsx} disabled={!filtered.length}><Download className="h-4 w-4" />{t("export_excel")}</Button>
            <Link href="/staff/new"><Button><Plus className="h-4 w-4" />{t("add_staff")}</Button></Link>
          </>
        }
      />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-9" aria-label={t("search")} placeholder={t("search_staff_placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={job} onValueChange={setJob}>
              <SelectTrigger className="md:w-44" aria-label={t("job_type")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all_job_types")}</SelectItem>
                {JOB_TYPES.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="md:w-44" aria-label={t("department")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all_departments")}</SelectItem>
                {(data?.departments ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{lang === "ar" ? d.name_ar : d.name_en}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="md:w-48" aria-label={t("status")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => <SelectItem key={f} value={f}>{t(`filter_${f}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : error ? (
            <p className="py-8 text-center text-destructive">{t("error")}</p>
          ) : filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="p-2 text-start">{t("full_name")}</th>
                      <th className="p-2 text-start">{t("job_type")}</th>
                      <th className="p-2 text-start">{t("department")}</th>
                      <th className="p-2 text-start">{t("his_user_id")}</th>
                      <th className="p-2 text-start">{t("status")}</th>
                      <th className="p-2 text-center">{t("score")}</th>
                      <th className="p-2 text-start">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-medium">
                          <Link href={`/staff/${s.id}`} className="hover:underline">{s.full_name}</Link>
                          {s.needs_review && <Badge variant="warning" className="ms-2">{t("needs_verification")}</Badge>}
                          {!s.is_active && <Badge variant="secondary" className="ms-2">{t("inactive")}</Badge>}
                        </td>
                        <td className="p-2">{s.job_type}</td>
                        <td className="p-2">{(lang === "ar" ? s.department?.name_ar : s.department?.name_en) || "-"}</td>
                        <td className="p-2" dir="ltr">{s.his_user_id || "-"}</td>
                        <td className="p-2"><RegistrationBadge status={s.registration_status} /></td>
                        <td className="p-2 text-center"><ScoreBadge score={s.manual_score} /></td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            <Link href={`/staff/${s.id}`}><Button size="sm" variant="outline">{t("view_profile")}</Button></Link>
                            {canManage && (
                              <Button size="sm" variant="destructive" onClick={() => setClearTarget(s)}>{t("reset_evaluations")}</Button>
                            )}
                            {canManage && s.manual_score !== 0 && (
                              <Button size="sm" variant="outline" onClick={() => setResetTarget(s)}>{t("reset_score")}</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between pt-4 text-sm">
                  <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t("previous")}</Button>
                  <span className="tabular-nums text-muted-foreground">{page + 1} / {pages}</span>
                  <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>{t("next")}</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(o) => { if (!o) { setResetTarget(null); setResetReason(""); } }}
        title={t("reset_score")}
        description={resetTarget ? `${resetTarget.full_name} — ${t("reset_score_warning")}` : ""}
        confirmLabel={t("reset_score")}
        destructive
        busy={busy}
        onConfirm={doReset}
      >
        <Textarea aria-label={t("reason")} placeholder={t("reset_reason_placeholder")} value={resetReason} onChange={(e) => setResetReason(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!clearTarget}
        onOpenChange={(o) => { if (!o) { setClearTarget(null); setResetReason(""); } }}
        title={t("reset_evaluations")}
        description={clearTarget ? `${clearTarget.full_name} — ${t("reset_evaluations_warning")}` : ""}
        confirmLabel={t("reset_evaluations")}
        destructive
        busy={busy}
        onConfirm={doClear}
      >
        <Textarea aria-label={t("reason")} placeholder={t("reset_reason_placeholder")} value={resetReason} onChange={(e) => setResetReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
