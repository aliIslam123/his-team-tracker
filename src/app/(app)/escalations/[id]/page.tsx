"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EscalationStatusBadge, Loading, PointsBadge, ResultBadge, ScoreBadge } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { buildEscalationLetter } from "@/lib/escalation";
import { formatDateTime } from "@/lib/format";
import { errorKey } from "@/lib/errors";

const EDITABLE = ["draft", "pending_review", "returned"];

export default function EscalationReviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang, dir } = useLanguage();
  const { canManage } = useUser();
  const router = useRouter();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading } = useLoad(async () => {
    const repo = getRepo();
    const esc = await repo.getEscalation(id);
    if (!esc) return null;
    const [staff, evaluations] = await Promise.all([repo.getStaff(esc.staff_member_id), repo.listEvaluations({ staffId: esc.staff_member_id })]);
    return { esc, staff, evaluations };
  }, [id]);

  // Fill the editor once the data arrives: a saved draft wins, otherwise generate the letter from the evaluations.
  useEffect(() => {
    if (!data) return;
    setNotes(data.esc.supervisor_notes ?? "");
    if (data.esc.draft_text) setText(data.esc.draft_text);
    else if (data.staff) setText(buildEscalationLetter({ staff: data.staff, evaluations: data.evaluations, lang }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (loading) return <Loading />;
  if (!data) return <p className="p-4 text-muted-foreground">{t("no_data")}</p>;

  const { esc, staff, evaluations } = data;
  const editable = EDITABLE.includes(esc.status);
  const canReview = canManage && editable;

  const run = async (fn: () => Promise<void>, done?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast.success(t("success"));
      done?.();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const review = (action: "approve" | "reject" | "return") =>
    run(() => getRepo().reviewEscalation(id, action, text, notes), () => router.push("/escalations"));

  const regenerate = () => {
    if (staff) setText(buildEscalationLetter({ staff, evaluations, lang }));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success(t("copied")); } catch { toast.error(t("error")); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="text-2xl font-bold">{t("escalation_review")}</h1>
        <EscalationStatusBadge status={esc.status} />
      </div>

      <Card className="no-print">
        <CardHeader><CardTitle><Link href={`/staff/${esc.staff_member_id}`} className="hover:underline">{esc.staff_name}</Link></CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span>{staff?.job_type} — {(lang === "ar" ? staff?.department?.name_ar : staff?.department?.name_en) || t("no_department")}</span>
          <span className="flex items-center gap-2">{t("score")}: <ScoreBadge score={staff?.manual_score ?? esc.total_points} /></span>
          <span>{t("total_evaluations")}: {evaluations.length}</span>
        </CardContent>
      </Card>

      <Card className="no-print">
        <CardHeader><CardTitle>{t("evaluations_basis")}</CardTitle></CardHeader>
        <CardContent>
          {evaluations.length === 0 ? <p className="text-sm text-muted-foreground">{t("no_evaluations")}</p> : (
            <ul className="divide-y text-sm">
              {evaluations.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-muted-foreground">{formatDateTime(e.created_at, lang)} · {e.reporter_name}</span>
                  <span className="flex items-center gap-2"><ResultBadge id={e.result} /><PointsBadge points={e.points} /></span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="no-print">
        <CardHeader><CardTitle>{t("letter_draft")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea aria-label={t("letter_draft")} dir={dir} value={text} onChange={(e) => setText(e.target.value)} rows={16} readOnly={!canReview} />
          {canReview && <Textarea aria-label={t("supervisor_notes")} placeholder={t("supervisor_notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          {!canManage && <p className="text-sm text-muted-foreground">{t("supervisor_required")}</p>}
          {!editable && esc.supervisor_notes && <p className="text-sm text-muted-foreground">{t("supervisor_notes")}: {esc.supervisor_notes}</p>}
          <div className="flex flex-wrap gap-2">
            {canReview && <Button onClick={() => review("approve")} disabled={busy}>{t("approve")}</Button>}
            {canReview && <Button variant="destructive" onClick={() => review("reject")} disabled={busy}>{t("reject")}</Button>}
            {canReview && <Button variant="outline" onClick={() => review("return")} disabled={busy}>{t("return_info")}</Button>}
            {canReview && <Button variant="secondary" onClick={() => run(() => getRepo().saveEscalationDraft(id, text))} disabled={busy}>{t("save_draft")}</Button>}
            {canReview && staff && <Button variant="ghost" onClick={regenerate} disabled={busy}>{t("regenerate")}</Button>}
            <Button variant="secondary" onClick={copy}>{t("copy")}</Button>
            <Button variant="secondary" onClick={() => window.print()}>{t("print_pdf")}</Button>
          </div>
        </CardContent>
      </Card>

      {/* only this block is printed (see .print-area in globals.css) */}
      <div className="print-area hidden whitespace-pre-wrap text-base leading-8 print:block" dir={dir}>{text}</div>
    </div>
  );
}
