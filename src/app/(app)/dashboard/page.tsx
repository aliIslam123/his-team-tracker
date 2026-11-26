"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, EscalationStatusBadge, FollowupStatusBadge, Loading, PageHeader, PointsBadge, ResultBadge, ScoreBadge, StatCard } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { getRepo } from "@/lib/repo";
import { ESCALATION_THRESHOLD, OPEN_ESCALATION_STATUSES } from "@/lib/evaluation";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";

const OPEN_FOLLOWUP = ["pending", "scheduled", "in_progress"];

export default function DashboardPage() {
  const { t, lang } = useLanguage();
  const { canManage, formHref } = useUser();
  const allowed = useRequirePermission("analytics.view");

  const { data, loading, error } = useLoad(async () => {
    const repo = getRepo();
    const [staff, evaluations, followups, escalations] = await Promise.all([
      repo.listStaff(), repo.listEvaluations(), repo.listFollowups(), repo.listEscalations(),
    ]);
    return { staff, evaluations, followups, escalations };
  }, [], allowed);

  if (!allowed) return <Loading />;
  if (loading) return <Loading />;
  if (error || !data) return <p className="p-4 text-destructive">{t("error")}</p>;

  const { staff, evaluations, followups, escalations } = data;
  const active = staff.filter((s) => s.is_active);
  const registered = active.filter((s) => s.registration_status === "registered").length;
  const pct = active.length ? Math.round((registered / active.length) * 100) : 0;
  const review = active.filter((s) => s.manual_score <= ESCALATION_THRESHOLD).length;
  const positive = evaluations.filter((e) => e.points > 0).length;
  const negative = evaluations.filter((e) => e.points < 0).length;

  const today = todayISO();
  const openFollowups = followups.filter((f) => OPEN_FOLLOWUP.includes(f.status));
  const overdue = openFollowups.filter((f) => f.due_date < today).length;
  const openEscalations = escalations.filter((e) => (OPEN_ESCALATION_STATUSES as readonly string[]).includes(e.status));

  const needsAttention = active.filter((s) => s.manual_score < 0).sort((a, b) => a.manual_score - b.manual_score).slice(0, 6);
  const mostCooperative = active.filter((s) => s.manual_score > 0).sort((a, b) => b.manual_score - a.manual_score).slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("dashboard")}
        actions={
          <>
            {formHref && <Link href={formHref}><Button variant="outline">{t("evaluation_form")}</Button></Link>}
            {canManage && <Link href="/staff/new"><Button><Plus className="h-4 w-4" />{t("add_staff")}</Button></Link>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("total_staff")} value={active.length} href="/staff" />
        <StatCard label={t("successfully_registered")} value={registered} tone="success" hint={`${pct}%`} href="/staff?filter=registered" />
        <StatCard label={t("pending_registration")} value={active.length - registered} tone="warning" href="/staff?filter=pending" />
        <StatCard label={t("requires_review")} value={review} tone="danger" href="/staff?filter=review" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label={t("total_evaluations")} value={evaluations.length} href="/history" />
        <StatCard label={t("group_positive")} value={positive} tone="success" />
        <StatCard label={t("group_negative")} value={negative} tone="danger" />
        <StatCard label={t("followups_due")} value={openFollowups.length} tone={overdue ? "warning" : "default"} hint={overdue ? `${t("overdue")}: ${overdue}` : undefined} href="/followups?filter=overdue" />
        <StatCard label={t("escalation_drafts_pending")} value={openEscalations.length} tone={openEscalations.length ? "danger" : "default"} href="/escalations" />
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{t("registration_progress")}</span>
            <span className="tabular-nums text-muted-foreground">{registered} / {active.length} ({pct}%)</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-success transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("needs_attention")}</CardTitle></CardHeader>
          <CardContent>
            {needsAttention.length === 0 ? <EmptyState /> : (
              <ul className="divide-y text-sm">
                {needsAttention.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <Link href={`/staff/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                    <ScoreBadge score={s.manual_score} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("most_cooperative")}</CardTitle></CardHeader>
          <CardContent>
            {mostCooperative.length === 0 ? <EmptyState /> : (
              <ul className="divide-y text-sm">
                {mostCooperative.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <Link href={`/staff/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                    <ScoreBadge score={s.manual_score} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t("upcoming_followups")}</CardTitle>
            <Link href="/followups" className="text-xs text-primary hover:underline">{t("view_all")}</Link>
          </CardHeader>
          <CardContent>
            {openFollowups.length === 0 ? <EmptyState /> : (
              <ul className="divide-y text-sm">
                {openFollowups.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/staff/${f.staff_member_id}`} className="font-medium hover:underline">{f.staff_name}</Link>
                      <p className="text-xs text-muted-foreground">{formatDate(f.due_date, lang)}</p>
                    </div>
                    <FollowupStatusBadge status={f.status} overdue={f.due_date < today} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t("escalations")}</CardTitle>
            <Link href="/escalations" className="text-xs text-primary hover:underline">{t("view_all")}</Link>
          </CardHeader>
          <CardContent>
            {openEscalations.length === 0 ? <EmptyState text={t("no_escalation")} /> : (
              <ul className="divide-y text-sm">
                {openEscalations.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/escalations/${e.id}`} className="font-medium hover:underline">{e.staff_name}</Link>
                    <EscalationStatusBadge status={e.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t("recent_evaluations")}</CardTitle>
          <Link href="/history" className="text-xs text-primary hover:underline">{t("view_all")}</Link>
        </CardHeader>
        <CardContent>
          {evaluations.length === 0 ? <EmptyState /> : (
            <ul className="divide-y text-sm">
              {evaluations.slice(0, 8).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/staff/${e.staff_member_id}`} className="font-medium hover:underline">{e.staff_name}</Link>
                    <p className="text-xs text-muted-foreground">{e.reporter_name} · {formatDateTime(e.created_at, lang)}</p>
                  </div>
                  <div className="flex items-center gap-2"><ResultBadge id={e.result} /><PointsBadge points={e.points} /></div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
