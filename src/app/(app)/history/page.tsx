"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, PageHeader, PointsBadge, ResultBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { groupForPoints, normalizeArabic, resultLabel } from "@/lib/evaluation";
import { downloadXlsx } from "@/lib/export";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;

export default function EvaluationsHistoryPage() {
  const { t, lang } = useLanguage();
  const { canManage } = useUser();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const { data, loading, error } = useLoad(() => getRepo().listEvaluations());

  const filtered = useMemo(() => {
    const nq = normalizeArabic(q);
    return (data ?? []).filter((e) => {
      if (group !== "all" && groupForPoints(e.points) !== group) return false;
      const day = e.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!nq) return true;
      return normalizeArabic(e.staff_name).includes(nq) || normalizeArabic(e.reporter_name).includes(nq);
    });
  }, [data, q, group, from, to]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const exportXlsx = () =>
    downloadXlsx("evaluations.xlsx", "Evaluations", filtered.map((e) => ({
      [t("date_time")]: formatDateTime(e.created_at, lang),
      [t("full_name")]: e.staff_name,
      [t("job_type")]: e.job_type,
      [t("outcome")]: resultLabel(e.result, lang),
      [t("points")]: e.points,
      [t("reporter_name")]: e.reporter_name,
      ...(canManage ? { [t("reporter_phone")]: e.reporter_phone } : {}),
      [t("notes")]: e.notes ?? "",
    })));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("history")}
        description={data ? `${filtered.length} / ${data.length}` : undefined}
        actions={<Button variant="outline" onClick={exportXlsx} disabled={!filtered.length}><Download className="h-4 w-4" />{t("export_excel")}</Button>}
      />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-9" aria-label={t("search")} placeholder={t("search_history_placeholder")} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </div>
            <Select value={group} onValueChange={(v) => { setGroup(v); setPage(0); }}>
              <SelectTrigger className="md:w-44" aria-label={t("outcome")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all_results")}</SelectItem>
                <SelectItem value="positive">{t("group_positive")}</SelectItem>
                <SelectItem value="negative">{t("group_negative")}</SelectItem>
                <SelectItem value="neutral">{t("group_neutral")}</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" className="md:w-40" aria-label={t("date_from")} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
            <Input type="date" className="md:w-40" aria-label={t("date_to")} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : error ? (
            <p className="py-8 text-center text-destructive">{t("error")}</p>
          ) : filtered.length === 0 ? (
            <EmptyState text={t("no_evaluations")} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="p-2 text-start">{t("date_time")}</th>
                      <th className="p-2 text-start">{t("full_name")}</th>
                      <th className="p-2 text-start">{t("outcome")}</th>
                      <th className="p-2 text-center">{t("points")}</th>
                      <th className="p-2 text-start">{t("reporter_name")}</th>
                      {canManage && <th className="p-2 text-start">{t("reporter_phone")}</th>}
                      <th className="p-2 text-start">{t("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} className="border-b border-border/60 align-top hover:bg-muted/40">
                        <td className="whitespace-nowrap p-2">{formatDateTime(e.created_at, lang)}</td>
                        <td className="p-2 font-medium"><Link href={`/staff/${e.staff_member_id}`} className="hover:underline">{e.staff_name}</Link></td>
                        <td className="p-2"><ResultBadge id={e.result} /></td>
                        <td className="p-2 text-center"><PointsBadge points={e.points} /></td>
                        <td className="p-2">{e.reporter_name}</td>
                        {canManage && <td className="p-2" dir="ltr">{e.reporter_phone}</td>}
                        <td className="max-w-xs p-2 text-muted-foreground">{e.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between pt-4 text-sm">
                  <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>{t("previous")}</Button>
                  <span className="tabular-nums text-muted-foreground">{current + 1} / {pages}</span>
                  <Button size="sm" variant="outline" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{t("next")}</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
