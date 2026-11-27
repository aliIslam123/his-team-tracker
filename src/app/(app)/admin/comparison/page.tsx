"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { useLoad } from "@/hooks/use-load";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Loading, EmptyState } from "@/components/shared";
import { getRepo } from "@/lib/repo";
import type { HospitalComparison } from "@/lib/types";

/** super_admin: headline numbers of EVERY hospital side by side. */
export default function ComparisonPage() {
  const allowed = useRequirePermission("comparison.view");
  const { t, lang } = useLanguage();
  const { setScope } = useUser();
  const router = useRouter();
  const { data, loading } = useLoad(() => getRepo().compareHospitals(), [], allowed);
  const [busy, setBusy] = useState<string | null>(null);

  if (!allowed) return <Loading />;

  const open = async (h: HospitalComparison) => {
    setBusy(h.hospital_id);
    try {
      setScope(h.hospital_id);
      router.push("/dashboard");
    } finally {
      setBusy(null);
    }
  };

  const pct = (h: HospitalComparison) =>
    h.staff_total > 0 ? Math.round((h.staff_registered / h.staff_total) * 100) : 0;

  return (
    <div className="space-y-4">
      <PageHeader title={t("comparison")} description={t("comparison_desc")} />

      {loading ? (
        <Loading />
      ) : !data || data.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {/* cards: one per hospital, easy to scan on mobile */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((h) => (
              <div key={h.hospital_id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{h.hospital_name}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">/h/{h.hospital_slug}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={h.hospital_active ? "success" : "secondary"}>
                      {h.hospital_active ? t("hospital_active") : t("hospital_inactive")}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy === h.hospital_id}
                      onClick={() => open(h)}
                    >
                      <Eye className="h-4 w-4" /> {t("view")}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    [t("comparison_team"), h.team_total],
                    [t("stat_registered"), h.registered_beds],
                    [t("comparison_beds"), h.beds_total],
                    [t("comparison_awaiting_engineer"), h.pending_beds],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-muted/60 p-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {t("followups_overdue")}: <b className="text-destructive">{h.followups_overdue}</b>
                  </span>
                  <span>
                    {t("escalations_pending")}: <b>{h.escalations_pending}</b>
                  </span>
                </div>
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{t("registration_progress")}</span>
                    <span className="font-medium">{pct(h)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-success transition-all"
                      style={{ width: `${pct(h)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* full table for the big screen */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{t("hospital")}</th>
                  <th className="p-3 text-start">{t("comparison_team")}</th>
                  <th className="p-3 text-start">{t("stat_registered")}</th>
                  <th className="p-3 text-start">{t("comparison_beds")}</th>
                  <th className="p-3 text-start">{t("comparison_awaiting_engineer")}</th>
                  <th className="p-3 text-start">{t("followups_overdue")}</th>
                  <th className="p-3 text-start">{t("escalations_pending")}</th>
                  <th className="p-3 text-start">{t("registration_progress")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((h) => (
                  <tr key={h.hospital_id} className={h.hospital_active ? "" : "opacity-60"}>
                    <td className="p-3 font-medium">
                      {h.hospital_name}
                      <span className="ms-2 text-xs text-muted-foreground" dir="ltr">{h.hospital_slug}</span>
                    </td>
                    <td className="p-3">{h.team_total}</td>
                    <td className="p-3">{h.registered_beds}</td>
                    <td className="p-3">{h.beds_total}</td>
                    <td className="p-3">{h.pending_beds > 0 ? <span className="font-bold text-warning">{h.pending_beds}</span> : h.pending_beds}</td>
                    <td className="p-3">{h.followups_overdue > 0 ? <span className="font-bold text-destructive">{h.followups_overdue}</span> : h.followups_overdue}</td>
                    <td className="p-3">{h.escalations_pending}</td>
                    <td className="p-3">{pct(h)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            {lang === "ar"
              ? "الأرقام محسوبة من قاعدة البيانات مباشرة لكل مستشفى (بدون النزول لبيانات موظف محدد)."
              : "Numbers are aggregated per hospital directly in the database."}
          </p>
          <div className="text-center">
            <Link href="/admin/hospitals" className="text-sm text-primary hover:underline">{t("hospitals")}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
