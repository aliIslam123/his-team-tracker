"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Loading, PageHeader, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { getRepo } from "@/lib/repo";
import { EVAL_OPTIONS } from "@/lib/evaluation";
import { JOB_TYPES } from "@/lib/validations";
import { monthKey } from "@/lib/format";

const COLORS = { primary: "#1e3a8a", success: "#16a34a", danger: "#dc2626", warning: "#ea580c", info: "#0284c7", muted: "#94a3b8" };

function Chart({ children, height = 288 }: { children: React.ReactElement; height?: number }) {
  // charts are always laid out left-to-right; labels (Arabic included) still render correctly
  return <div dir="ltr" style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

export default function AnalyticsPage() {
  const { t, lang } = useLanguage();
  const allowed = useRequirePermission("analytics.view");
  const { data, loading, error } = useLoad(async () => {
    const repo = getRepo();
    const [staff, evaluations, departments] = await Promise.all([repo.listStaff(), repo.listEvaluations(), repo.listDepartments()]);
    return { staff, evaluations, departments };
  }, [], allowed);

  const charts = useMemo(() => {
    if (!data) return null;
    const active = data.staff.filter((s) => s.is_active);

    const byJob = JOB_TYPES.map((j) => ({ name: j, value: active.filter((s) => s.job_type === j).length }));

    const regKeys = ["registered", "pending", "needs_followup", "not_started"] as const;
    const regColors = [COLORS.success, COLORS.info, COLORS.warning, COLORS.muted];
    const byStatus = regKeys.map((k, i) => ({ name: t(`reg_${k}`), value: active.filter((s) => s.registration_status === k).length, fill: regColors[i] })).filter((d) => d.value > 0);

    const byResult = EVAL_OPTIONS.map((o) => {
      const n = data.evaluations.filter((e) => e.result === o.id).length;
      return { name: lang === "ar" ? o.ar : o.en, positive: o.group === "positive" ? n : 0, negative: o.group === "negative" ? n : 0, neutral: o.group === "neutral" ? n : 0, total: n };
    }).filter((r) => r.total > 0);

    // last 6 calendar months
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const monthly = months.map((m) => {
      const inMonth = data.evaluations.filter((e) => monthKey(e.created_at) === m);
      return { name: m, positive: inMonth.filter((e) => e.points > 0).length, negative: inMonth.filter((e) => e.points < 0).length };
    });

    const deptRows = [
      ...data.departments.map((d) => ({ id: d.id, name: lang === "ar" ? d.name_ar : d.name_en })),
      { id: "__none__", name: t("no_department") },
    ].map((d) => {
      const inDept = active.filter((s) => (d.id === "__none__" ? !s.department_id : s.department_id === d.id));
      const registered = inDept.filter((s) => s.registration_status === "registered").length;
      return { name: d.name, registered, remaining: inDept.length - registered, total: inDept.length };
    }).filter((d) => d.total > 0);

    const ranked = active.slice().sort((a, b) => b.manual_score - a.manual_score);
    return {
      byJob, byStatus, byResult, monthly, deptRows,
      top: ranked.filter((s) => s.manual_score > 0).slice(0, 10),
      bottom: ranked.filter((s) => s.manual_score < 0).reverse().slice(0, 10),
    };
  }, [data, lang, t]);

  if (!allowed) return <Loading />;
  if (loading) return <Loading />;
  if (error || !charts) return <p className="p-4 text-destructive">{t("error")}</p>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("analytics")} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("staff_by_job_type")}</CardTitle></CardHeader>
          <CardContent>
            <Chart>
              <BarChart data={charts.byJob}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" name={t("total_staff")} fill={COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Chart>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("registration_progress")}</CardTitle></CardHeader>
          <CardContent>
            {charts.byStatus.length === 0 ? <EmptyState /> : (
              <Chart>
                <PieChart>
                  <Pie data={charts.byStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {charts.byStatus.map((d) => <Cell key={d.name} fill={d.fill} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </Chart>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("monthly_trends")}</CardTitle></CardHeader>
          <CardContent>
            <Chart>
              <BarChart data={charts.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="positive" name={t("group_positive")} fill={COLORS.success} radius={[4, 4, 0, 0]} />
                <Bar dataKey="negative" name={t("group_negative")} fill={COLORS.danger} radius={[4, 4, 0, 0]} />
              </BarChart>
            </Chart>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("completion_by_department")}</CardTitle></CardHeader>
          <CardContent>
            {charts.deptRows.length === 0 ? <EmptyState /> : (
              <Chart>
                <BarChart data={charts.deptRows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="registered" stackId="a" name={t("successfully_registered")} fill={COLORS.success} />
                  <Bar dataKey="remaining" stackId="a" name={t("pending_registration")} fill={COLORS.muted} />
                </BarChart>
              </Chart>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader><CardTitle>{t("interactions_by_outcome")}</CardTitle></CardHeader>
          <CardContent>
            {charts.byResult.length === 0 ? <EmptyState text={t("no_evaluations")} /> : (
              <Chart height={Math.max(220, charts.byResult.length * 38)}>
                <BarChart data={charts.byResult} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={200} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="positive" stackId="r" name={t("group_positive")} fill={COLORS.success} />
                  <Bar dataKey="negative" stackId="r" name={t("group_negative")} fill={COLORS.danger} />
                  <Bar dataKey="neutral" stackId="r" name={t("group_neutral")} fill={COLORS.muted} />
                </BarChart>
              </Chart>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("top_cooperative")}</CardTitle></CardHeader>
          <CardContent>
            {charts.top.length === 0 ? <EmptyState /> : (
              <ol className="divide-y text-sm">
                {charts.top.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2"><Link href={`/staff/${s.id}`} className="hover:underline">{s.full_name}</Link><ScoreBadge score={s.manual_score} /></li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("needs_attention")}</CardTitle></CardHeader>
          <CardContent>
            {charts.bottom.length === 0 ? <EmptyState /> : (
              <ol className="divide-y text-sm">
                {charts.bottom.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2"><Link href={`/staff/${s.id}`} className="hover:underline">{s.full_name}</Link><ScoreBadge score={s.manual_score} /></li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
