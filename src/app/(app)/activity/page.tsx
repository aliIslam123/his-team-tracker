"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Loading, PageHeader } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { useRequireRole } from "@/hooks/use-require-role";
import { getRepo } from "@/lib/repo";
import { formatDateTime } from "@/lib/format";

function summarize(v: Record<string, unknown> | null): string {
  if (!v) return "";
  try {
    const s = JSON.stringify(v);
    return s.length > 140 ? s.slice(0, 137) + "…" : s;
  } catch {
    return "";
  }
}

export default function ActivityLogPage() {
  const { t, lang } = useLanguage();
  const allowed = useRequireRole(["super_admin", "hospital_admin", "supervisor"]);
  const [q, setQ] = useState("");
  const { data, loading, error } = useLoad(() => getRepo().listAudits(500), [], allowed);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((a) => !s || a.action.toLowerCase().includes(s) || a.entity_type.toLowerCase().includes(s) || (a.actor_name ?? "").toLowerCase().includes(s));
  }, [data, q]);

  if (!allowed || loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("activity_logs")} description={t("activity_desc")} />
      <Card>
        <CardHeader>
          <div className="relative max-w-md">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2 text-start">{t("audit_timestamp")}</th>
                    <th className="p-2 text-start">{t("audit_action")}</th>
                    <th className="p-2 text-start">{t("audit_entity")}</th>
                    <th className="p-2 text-start">{t("audit_actor")}</th>
                    <th className="p-2 text-start">{t("details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-b align-top hover:bg-muted/50">
                      <td className="whitespace-nowrap p-2">{formatDateTime(a.created_at, lang)}</td>
                      <td className="p-2"><Badge variant="secondary">{a.action}</Badge></td>
                      <td className="p-2">{a.entity_type}</td>
                      <td className="p-2">{a.actor_name ?? t("public_form")}</td>
                      <td className="max-w-sm break-words p-2 text-xs text-muted-foreground" dir="ltr">{summarize(a.new_values)}{a.reason ? ` — ${a.reason}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
