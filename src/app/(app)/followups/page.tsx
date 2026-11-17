"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, FollowupStatusBadge, Loading, PageHeader } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { formatDate, todayISO } from "@/lib/format";
import { errorKey } from "@/lib/errors";
import type { FollowupStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPEN: FollowupStatus[] = ["pending", "scheduled", "in_progress"];
const TABS = ["open", "overdue", "completed", "all"] as const;
type Tab = (typeof TABS)[number];

export default function FollowupsPage() {
  const { t, lang } = useLanguage();
  const { formHref } = useUser();
  const [tab, setTab] = useState<Tab>("open");
  const { data, loading, error, reload } = useLoad(() => getRepo().listFollowups());
  const today = todayISO();

  const counts = useMemo(() => {
    const all = data ?? [];
    return {
      open: all.filter((f) => OPEN.includes(f.status)).length,
      overdue: all.filter((f) => OPEN.includes(f.status) && f.due_date < today).length,
      completed: all.filter((f) => f.status === "completed").length,
      all: all.length,
    };
  }, [data, today]);

  const list = useMemo(() => {
    const all = data ?? [];
    switch (tab) {
      case "open": return all.filter((f) => OPEN.includes(f.status));
      case "overdue": return all.filter((f) => OPEN.includes(f.status) && f.due_date < today);
      case "completed": return all.filter((f) => f.status === "completed");
      default: return all;
    }
  }, [data, tab, today]);

  const setStatus = async (id: string, status: FollowupStatus) => {
    try {
      await getRepo().setFollowupStatus(id, status);
      toast.success(t("success"));
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("followups")} />
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
            {t(`fu_tab_${k}`)} <span className="tabular-nums opacity-80">({counts[k]})</span>
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          {list.length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-start">{t("full_name")}</th>
                    <th className="p-2 text-start">{t("followup_date")}</th>
                    <th className="p-2 text-start">{t("notes")}</th>
                    <th className="p-2 text-start">{t("status")}</th>
                    <th className="p-2 text-start">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => {
                    const open = OPEN.includes(f.status);
                    return (
                      <tr key={f.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-medium"><Link href={`/staff/${f.staff_member_id}`} className="hover:underline">{f.staff_name}</Link></td>
                        <td className="whitespace-nowrap p-2">{formatDate(f.due_date, lang)}</td>
                        <td className="p-2 text-muted-foreground">{f.notes || "-"}</td>
                        <td className="p-2"><FollowupStatusBadge status={f.status} overdue={f.due_date < today} /></td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {open && <Button size="sm" onClick={() => setStatus(f.id, "completed")}>{t("mark_done")}</Button>}
                            {open && <Button size="sm" variant="outline" onClick={() => setStatus(f.id, "cancelled")}>{t("cancel_followup")}</Button>}
                            {!open && <Button size="sm" variant="outline" onClick={() => setStatus(f.id, "scheduled")}>{t("reopen")}</Button>}
                            {formHref && <Link href={formHref}><Button size="sm" variant="secondary">{t("evaluate")}</Button></Link>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
