"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { CheckCircle2, Moon, Plus, Search, Sun } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { getRepo } from "@/lib/repo";
import { EVAL_OPTIONS, normalizeEgyptPhone, type EvalGroup } from "@/lib/evaluation";
import { JOB_TYPES } from "@/lib/validations";
import { errorKey } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import type { JobType, PublicStats, StaffLite } from "@/lib/types";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "his_form_draft";
const EVALUATOR_KEY = "his_evaluator";

const GROUPS: { id: EvalGroup; labelKey: string; tone: string; active: string }[] = [
  { id: "positive", labelKey: "group_positive", tone: "text-success", active: "border-success bg-success/10" },
  { id: "negative", labelKey: "group_negative", tone: "text-destructive", active: "border-destructive bg-destructive/10" },
  { id: "neutral", labelKey: "group_neutral", tone: "text-muted-foreground", active: "border-primary bg-primary/10" },
];

/**
 * The public evaluation form of ONE hospital, served at /h/<slug>/.
 * No login required: every call goes through the slug-scoped SQL functions,
 * so the browser never sees any other hospital's data.
 */
export default function HospitalEvaluationPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { isAuthed } = useUser();
  const ar = lang === "ar";

  const [evaluatorName, setEvaluatorName] = useState("");
  const [evaluatorPhone, setEvaluatorPhone] = useState("");
  const [staffQuery, setStaffQuery] = useState("");
  const [staffResults, setStaffResults] = useState<StaffLite[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<StaffLite | null>(null);
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");
  const [followup, setFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newJob, setNewJob] = useState<JobType | "">("");
  const [newHis, setNewHis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [stats, setStats] = useState<PublicStats>({ total: 0, registered: 0, pending: 0, review: 0 });
  const hydrated = useRef(false);

  /* ---- restore evaluator identity + unsent draft ---- */
  // Restore after mount in a microtask: the fields still start empty during SSR,
  // and the updates are not synchronous inside the effect body.
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      try {
        const who = JSON.parse(localStorage.getItem(EVALUATOR_KEY) ?? "null");
        if (who) { setEvaluatorName(who.name ?? ""); setEvaluatorPhone(who.phone ?? ""); }
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
        if (d) {
          setNotes(d.notes ?? "");
          setResult(d.result ?? "");
          setFollowup(!!d.followup);
          setFollowupDate(d.followupDate ?? "");
          setFollowupNote(d.followupNote ?? "");
        }
      } catch {}
      hydrated.current = true;
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(EVALUATOR_KEY, JSON.stringify({ name: evaluatorName, phone: evaluatorPhone }));
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ notes, result, followup, followupDate, followupNote }));
    } catch {}
  }, [evaluatorName, evaluatorPhone, notes, result, followup, followupDate, followupNote]);

  /* ---- summary numbers (scoped to this hospital's slug) ---- */
  const refreshStats = useCallback(() => {
    getRepo().publicStatsPublic(slug).then(setStats).catch(() => {});
  }, [slug]);
  useEffect(() => { refreshStats(); }, [refreshStats]);

  /* ---- debounced staff search (scoped to this hospital's slug) ---- */
  useEffect(() => {
    if (selectedStaff) return;
    const q = staffQuery.trim();
    if (q.length < 2) {
      void Promise.resolve().then(() => { setStaffResults([]); setSearchedFor(""); });
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await getRepo().searchStaffPublic(slug, q);
        if (alive) { setStaffResults(r); setSearchedFor(q); }
      } catch {
        if (alive) { setStaffResults([]); setSearchedFor(q); }
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [staffQuery, selectedStaff, slug]);

  const pickStaff = (s: StaffLite) => {
    setSelectedStaff(s);
    setStaffQuery("");
    setStaffResults([]);
    setShowNew(false);
  };

  const handleAddNew = async () => {
    if (newName.trim().length < 3 || !newJob) { toast.error(t("new_staff_required")); return; }
    try {
      const s = await getRepo().addStaffPublic(slug, { full_name: newName, job_type: newJob, his_user_id: newHis.trim() || null });
      toast.success(t("new_staff_added"));
      pickStaff(s);
      setNewName(""); setNewJob(""); setNewHis("");
      refreshStats();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (evaluatorName.trim().length < 2 || !evaluatorPhone.trim()) { toast.error(t("name_phone_required")); return; }
    const phone = normalizeEgyptPhone(evaluatorPhone);
    if (!phone) { toast.error(t("err_invalid_phone")); return; }
    if (!selectedStaff) { toast.error(t("select_staff")); return; }
    if (!result) { toast.error(t("select_result")); return; }
    if (followup && !followupDate) { toast.error(t("followup_date_required")); return; }

    setSubmitting(true);
    try {
      await getRepo().submitEvaluationPublic(slug, {
        staffId: selectedStaff.id,
        reporterName: evaluatorName.trim(),
        reporterPhone: phone,
        result,
        notes: notes.trim() || null,
        followupDate: followup ? followupDate : null,
        followupNote: followup ? followupNote.trim() || null : null,
      });
      setSuccess(true);
      setResult(""); setNotes(""); setFollowup(false); setFollowupDate(""); setFollowupNote("");
      setSelectedStaff(null);
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      refreshStats();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <div className="absolute end-2 top-2 flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setLang(ar ? "en" : "ar")}>{ar ? "English" : "العربية"}</Button>
      <Button type="button" variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme")}>
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </div>
  );

  if (success) {
    return (
      <div className="relative flex min-h-screen flex-col bg-background">
        {header}
        <div className="flex flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-md text-center">
            <CardContent className="space-y-4 pt-8">
              <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
              <h2 className="text-xl font-bold">{t("eval_submitted")}</h2>
              <Button onClick={() => setSuccess(false)} className="w-full">{t("submit_another")}</Button>
              {isAuthed && <Link href="/dashboard" className="block text-sm text-primary hover:underline">{t("dashboard")}</Link>}
            </CardContent>
          </Card>
        </div>
        <footer className="border-t py-3 text-center text-xs text-muted-foreground no-print">
          created by Ali Abuelsoud and Ismail Ali
        </footer>
      </div>
    );
  }

  const noResults = !selectedStaff && searchedFor && staffQuery.trim() === searchedFor && staffResults.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-xl flex-1 space-y-4 p-4">
        <div className="relative py-4 text-center">
          {header}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Holool His" className="mx-auto mb-2 h-20 w-auto max-w-[300px] object-contain" />
          <h1 className="text-2xl font-bold">{t("form_title")}</h1>
          <p className="text-sm text-muted-foreground">{t("form_subtitle")}</p>
          <p className="mt-2 text-xs text-muted-foreground">created by Ali Abuelsoud and Ismail Ali</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-1">
                <label htmlFor="ev-name" className="text-sm font-medium">{t("evaluator_name")} *</label>
                <Input id="ev-name" autoComplete="name" value={evaluatorName} onChange={(e) => setEvaluatorName(e.target.value)} placeholder={t("full_name_placeholder")} />
              </div>
              <div className="space-y-1">
                <label htmlFor="ev-phone" className="text-sm font-medium">{t("evaluator_phone")} *</label>
                <Input id="ev-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={evaluatorPhone} onChange={(e) => setEvaluatorPhone(e.target.value)} placeholder="01XXXXXXXXX" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <label htmlFor="staff-search" className="text-sm font-medium">{t("who_evaluating")} *</label>
              {selectedStaff ? (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{selectedStaff.full_name}</p>
                    <p className="text-xs text-muted-foreground">{selectedStaff.job_type}{selectedStaff.his_user_id ? ` · ${selectedStaff.his_user_id}` : ""}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedStaff(null)}>{t("change")}</Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="staff-search" className="ps-9" placeholder={t("search_staff_placeholder")} value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} autoComplete="off" />
                  </div>
                  {staffResults.length > 0 && (
                    <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border" role="listbox">
                      {staffResults.map((s) => (
                        <li key={s.id}>
                          <button type="button" className="w-full p-2 text-start hover:bg-muted" onClick={() => pickStaff(s)}>
                            <span className="font-medium">{s.full_name}</span>
                            <span className="ms-2 text-xs text-muted-foreground">{s.job_type}{s.his_user_id ? ` · ${s.his_user_id}` : ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {noResults && <p className="text-xs text-muted-foreground">{t("no_staff_found")}</p>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowNew((v) => !v)}>
                    <Plus className="h-4 w-4" /> {t("add_new_name")}
                  </Button>
                </>
              )}
              {showNew && !selectedStaff && (
                <div className="space-y-2 rounded-lg border bg-muted p-3">
                  <Input aria-label={t("full_name")} placeholder={t("full_name")} value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <select aria-label={t("job_type")} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={newJob} onChange={(e) => setNewJob(e.target.value as JobType | "")}>
                    <option value="">{t("job_type")}</option>
                    {JOB_TYPES.map((j) => <option key={j} value={j}>{j}</option>)}
                  </select>
                  <Input aria-label={t("his_user_id")} dir="ltr" placeholder={t("his_id_optional")} value={newHis} onChange={(e) => setNewHis(e.target.value)} />
                  <Button type="button" size="sm" onClick={handleAddNew}>{t("save")}</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <p className="text-sm font-medium">{t("what_happened")} *</p>
              {GROUPS.map((g) => (
                <div key={g.id} className="space-y-2">
                  <p className={cn("text-xs font-semibold", g.tone)}>{t(g.labelKey)}</p>
                  {EVAL_OPTIONS.filter((o) => o.group === g.id).map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      aria-pressed={result === o.id}
                      onClick={() => setResult(o.id)}
                      className={cn("w-full rounded-lg border p-3 text-start text-sm transition-colors", result === o.id ? g.active : "border-border hover:bg-muted")}
                    >
                      {ar ? o.ar : o.en}
                    </button>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <label htmlFor="notes" className="text-sm font-medium">{t("notes_optional")}</label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notes_placeholder")} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="text-sm font-medium">{t("need_followup")}</p>
              <div className="flex gap-2">
                {[true, false].map((v) => (
                  <button
                    type="button"
                    key={String(v)}
                    aria-pressed={followup === v}
                    onClick={() => setFollowup(v)}
                    className={cn("flex-1 rounded-lg border p-2 text-sm", followup === v ? "border-primary bg-primary/10" : "border-border")}
                  >
                    {v ? t("yes") : t("no")}
                  </button>
                ))}
              </div>
              {followup && (
                <div className="space-y-2">
                  <Input type="date" aria-label={t("followup_date")} min={todayISO()} value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
                  <Input aria-label={t("notes")} placeholder={t("short_note_optional")} value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} />
                </div>
              )}
            </CardContent>
          </Card>

          <Button type="submit" className="h-12 w-full text-lg" disabled={submitting}>
            {submitting ? t("submitting") : t("submit_eval")}
          </Button>
        </form>

        {isAuthed && (
          <div className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold text-muted-foreground">{t("summary")}</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                [t("total_staff"), stats.total],
                [t("stat_registered"), stats.registered],
                [t("stat_pending"), stats.pending],
                [t("requires_review"), stats.review],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              ))}
            </div>
            <Link href="/dashboard" className="block text-center text-sm text-primary hover:underline">{t("admin_dashboard")}</Link>
            <Link href="/history" className="block text-center text-sm text-primary hover:underline">{t("history")}</Link>
          </div>
        )}
      </div>
      <footer className="border-t py-3 text-center text-xs text-muted-foreground no-print">
        created by Ali Abuelsoud and Ismail Ali
      </footer>
    </div>
  );
}
