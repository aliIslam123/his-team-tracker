"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, EscalationStatusBadge, Loading, PageHeader, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TABS = ["open", "approved", "rejected", "all"] as const;
type Tab = (typeof TABS)[number];
const OPEN = ["draft", "pending_review", "returned"];

export default function EscalationsPage() {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<Tab>("open");
  const { data, loading, error } = useLoad(() => getRepo().listEscalations());

  const list = useMemo(() => {
    const all = data ?? [];
    if (tab === "all") return all;
    if (tab === "open") return all.filter((e) => OPEN.includes(e.status));
    return all.filter((e) => e.status === tab);
  }, [data, tab]);

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("escalations")} description={t("escalations_desc")} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("rounded-full border px-4 py-1.5 text-sm", tab === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            {t(`esc_tab_${k}`)}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {list.length === 0 ? <EmptyState text={t("no_escalation")} /> : (
            <ul className="divide-y">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/staff/${e.staff_member_id}`} className="font-medium hover:underline">{e.staff_name}</Link>
                    <p className="text-sm text-muted-foreground">{e.job_type} — {formatDateTime(e.created_at, lang)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={e.total_points} />
                    <EscalationStatusBadge status={e.status} />
                    <Link href={`/escalations/${e.id}`}><Button size="sm" variant="outline">{t("view")}</Button></Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
