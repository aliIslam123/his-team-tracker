"use client";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/providers/language-provider";
import { getOption, groupForPoints, resultLabel } from "@/lib/evaluation";
import type { EscalationStatus, FollowupStatus } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FullPageSpinner() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground" role="status">{t("loading")}</p>
    </div>
  );
}

export function Loading() {
  const { t } = useLanguage();
  return <p className="p-4 text-sm text-muted-foreground" role="status">{t("loading")}</p>;
}

export function EmptyState({ text }: { text?: string }) {
  const { t } = useLanguage();
  return <p className="py-8 text-center text-sm text-muted-foreground">{text ?? t("no_data")}</p>;
}

const TONES = {
  default: "",
  success: "text-success",
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-info",
} as const;

export function StatCard({
  label, value, hint, tone = "default", href,
}: { label: string; value: React.ReactNode; hint?: string; tone?: keyof typeof TONES; href?: string }) {
  const body = (
    <Card className={cn(href && "transition-colors hover:bg-accent/40")}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold", TONES[tone])}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function ScoreBadge({ score }: { score: number }) {
  const variant = score > 0 ? "success" : score < 0 ? "destructive" : "secondary";
  return <Badge variant={variant} className="min-w-9 justify-center tabular-nums">{score > 0 ? `+${score}` : score}</Badge>;
}

export function ResultBadge({ id }: { id: string }) {
  const { lang } = useLanguage();
  const group = getOption(id)?.group ?? "neutral";
  const variant = group === "positive" ? "success" : group === "negative" ? "destructive" : "secondary";
  return <Badge variant={variant}>{resultLabel(id, lang)}</Badge>;
}

export function PointsBadge({ points }: { points: number }) {
  const g = groupForPoints(points);
  return <Badge variant={g === "positive" ? "success" : g === "negative" ? "destructive" : "secondary"} className="tabular-nums">{points > 0 ? `+${points}` : points}</Badge>;
}

export function FollowupStatusBadge({ status, overdue }: { status: FollowupStatus; overdue?: boolean }) {
  const { t } = useLanguage();
  const shown: FollowupStatus = overdue && (status === "pending" || status === "scheduled" || status === "in_progress") ? "overdue" : status;
  const variant = shown === "completed" ? "success" : shown === "overdue" ? "destructive" : shown === "cancelled" ? "secondary" : "info";
  return <Badge variant={variant}>{t(`fu_${shown}`)}</Badge>;
}

export function EscalationStatusBadge({ status }: { status: EscalationStatus }) {
  const { t } = useLanguage();
  const variant = status === "approved" ? "success" : status === "rejected" ? "destructive" : status === "returned" ? "warning" : "info";
  return <Badge variant={variant}>{t(`escalation_${status}`)}</Badge>;
}

export function RegistrationBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const variant = status === "registered" ? "success" : status === "needs_followup" ? "warning" : status === "pending" ? "info" : "secondary";
  return <Badge variant={variant}>{t(`reg_${status}`)}</Badge>;
}
