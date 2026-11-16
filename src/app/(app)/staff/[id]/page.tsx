"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, EscalationStatusBadge, FollowupStatusBadge, Loading, PointsBadge, RegistrationBadge, ResultBadge, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { OPEN_ESCALATION_STATUSES } from "@/lib/evaluation";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { errorKey } from "@/lib/errors";

export default function StaffProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const { canManage } = useUser();
  const router = useRouter();
  const [resetOpen, setResetOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, reload } = useLoad(async () => {
    const repo = getRepo();
    const [staff, evaluations, followups, escalations] = await Promise.all([
      repo.getStaff(id), repo.listEvaluations({ staffId: id }), repo.listFollowups({ staffId: id }), repo.listEscalations({ staffId: id }),
    ]);
    return { staff, evaluations, followups, escalations };
  }, [id]);

  if (loading) return <Loading />;
  if (!data?.staff) return <p className="p-4 text-muted-foreground">{t("no_data")}</p>;

  const { staff, evaluations, followups, escalations } = data;
  const today = todayISO();
  const openEscalation = escalations.find((e) => (OPEN_ESCALATION_STATUSES as readonly string[]).includes(e.status));
  const dept = (lang === "ar" ? staff.department?.name_ar : staff.department?.name_en) || "-";

  const doReset = async () => {
    setBusy(true);
    try {
      await getRepo().resetScore(id, reason.trim() || undefined);
      toast.success(t("success"));
      setResetOpen(false);
      setReason("");
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const createEscalation = async () => {
    setBusy(true);
    try {
      const escId = await getRepo().createEscalation(id);
      router.push(`/escalations/${escId}`);
    } catch (err) {
      toast.error(t(errorKey(err)));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">{staff.full_name.charAt(0)}</div>
          <div>
            <h1 className="text-xl font-bold">{staff.full_name}</h1>
            <p className="text-sm text-muted-foreground">{staff.job_type}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>{t("back")}</Button>
          <Link href={`/?staff=${staff.id}`}><Button size="sm">{t("evaluate")}</Button></Link>
          {canManage && <Link href={`/staff/${staff.id}/edit`}><Button size="sm" variant="secondary">{t("edit")}</Button></Link>}
          {canManage && !openEscalation && <Button size="sm" variant="outline" onClick={createEscalation} disabled={busy}>{t("create_escalation")}</Button>}
          {canManage && staff.manual_score !== 0 && <Button size="sm" variant="destructive" onClick={() => setResetOpen(true)}>{t("reset_score")}</Button>}
        </div>
      </div>

      {staff.needs_review && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{t("needs_verification_note")}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 md:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">{t("his_user_id")}</p><p className="font-medium" dir="ltr">{staff.his_user_id || "-"}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("department")}</p><p className="font-medium">{dept}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("status")}</p><RegistrationBadge status={staff.registration_status} /></div>
          <div><p className="text-xs text-muted-foreground">{t("score")}</p><ScoreBadge score={staff.manual_score} /></div>
          {staff.legacy_status && <div><p className="text-xs text-muted-foreground">{t("legacy_status")}</p><p className="font-medium">{staff.legacy_status}</p></div>}
          {!staff.is_active && <div><Badge variant="secondary">{t("inactive")}</Badge></div>}
        </CardContent>
      </Card>

      {(escalations.length > 0 || followups.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t("escalations")}</CardTitle></CardHeader>
            <CardContent>
              {escalations.length === 0 ? <EmptyState text={t("no_escalation")} /> : (
                <ul className="divide-y text-sm">
                  {escalations.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/escalations/${e.id}`} className="hover:underline">{formatDate(e.created_at, lang)}</Link>
                      <EscalationStatusBadge status={e.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("followups")}</CardTitle></CardHeader>
            <CardContent>
              {followups.length === 0 ? <EmptyState /> : (
                <ul className="divide-y text-sm">
                  {followups.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                      <span>{formatDate(f.due_date, lang)}{f.notes ? ` — ${f.notes}` : ""}</span>
                      <FollowupStatusBadge status={f.status} overdue={f.due_date < today} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
        <CardContent>
          {evaluations.length === 0 ? <EmptyState text={t("no_evaluations")} /> : (
            <ul className="space-y-3">
              {evaluations.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{e.reporter_name.charAt(0) || "?"}</div>
                  <div className="flex-1 rounded-2xl bg-muted/60 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{e.reporter_name}</span>
                      <div className="flex items-center gap-2"><ResultBadge id={e.result} /><PointsBadge points={e.points} /></div>
                    </div>
                    {e.notes && <p className="mt-1 text-sm">{e.notes}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(e.created_at, lang)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("reset_score")}
        description={`${staff.full_name} — ${t("reset_score_warning")}`}
        confirmLabel={t("reset_score")}
        destructive
        busy={busy}
        onConfirm={doReset}
      >
        <Textarea aria-label={t("reason")} placeholder={t("reset_reason_placeholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
