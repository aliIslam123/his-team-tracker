"use client";
import Link from "next/link";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, FollowupStatusBadge, Loading, PageHeader, ResultBadge, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { formatDate, formatDateTime } from "@/lib/format";

/** Member landing page: only his evaluations, follow-ups and beds. */
export default function MyTasksPage() {
  const { t, lang } = useLanguage();
  const { profile, formHref } = useUser();
  const { data, loading, error } = useLoad(async () => {
    const repo = getRepo();
    const [evaluations, followups, beds] = await Promise.all([
      repo.listEvaluations(), repo.listFollowups(), repo.listBeds(),
    ]);
    return { evaluations, followups, beds };
  });

  const beds = (data?.beds ?? []).filter((b) => !profile?.full_name || !b.owner_name || b.owner_name === profile.full_name);

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={t("my_tasks")}
        description={profile?.full_name ?? undefined}
        actions={formHref ? <Link href={formHref}><Button>{t("evaluate")}</Button></Link> : undefined}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("followups")}</CardTitle></CardHeader>
          <CardContent>
            {(data?.followups ?? []).length === 0 ? <EmptyState /> : (
              <ul className="divide-y text-sm">
                {data!.followups.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{f.staff_name} · {formatDate(f.due_date, lang)}</span>
                    <FollowupStatusBadge status={f.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("evaluations")}</CardTitle></CardHeader>
          <CardContent>
            {(data?.evaluations ?? []).length === 0 ? <EmptyState /> : (
              <ul className="divide-y text-sm">
                {data!.evaluations.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{e.staff_name} · {formatDateTime(e.created_at, lang)}</span>
                    <span className="flex items-center gap-2"><ResultBadge id={e.result} /><ScoreBadge score={e.points} /></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("beds")}</CardTitle></CardHeader>
        <CardContent>
          {beds.length === 0 ? <EmptyState /> : (
            <ul className="divide-y text-sm">
              {beds.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                  <span>{b.location} · {b.bed_no} · {b.patient_name || "—"}</span>
                  <Badge variant={b.updated_at ? "success" : "secondary"}>{formatDateTime(b.updated_at, lang)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
