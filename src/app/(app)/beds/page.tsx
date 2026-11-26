"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Check, CheckCheck, Download, Pencil, Plus, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, Loading, PageHeader, StatCard } from "@/components/shared";
import { BedDialog } from "@/components/beds/bed-dialog";
import { BedImportDialog } from "@/components/beds/import-dialog";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { downloadXlsx } from "@/lib/export";
import { errorKey } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { normalizeArabic } from "@/lib/evaluation";
import {
  BED_STATUS_FILTERS, STALE_DAYS, bedsToExportRows, dateTone, groupProgress, isBedStale, isGroupComplete,
  matchesStatus, ownerHue, tasksOf,
  type BedStatusFilter, type DateTone, type TaskGroup,
} from "@/lib/beds";
import type { BedRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type DateField = "dr_edit_date" | "nurse_edit_date";
const GROUPS: { group: TaskGroup; dateField: DateField }[] = [
  { group: "doctor", dateField: "dr_edit_date" },
  { group: "nurse", dateField: "nurse_edit_date" },
];

const OWNER_KEY = "beds_owner";
const POLL_MS = 30_000;

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const DATE_TONE: Record<DateTone, string> = {
  none: "",
  today: "border-success/60 bg-success/15",
  recent: "",
  stale: "border-warning/70 bg-warning/15 text-warning",
};

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function TaskBox({ done, label, bedLabel, onToggle }: { done: boolean; label: string; bedLabel: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${label} - ${bedLabel}`}
      title={label}
      onClick={onToggle}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        done ? "border-transparent bg-success text-white" : "border-input bg-background hover:bg-accent"
      )}
    >
      {done && <Check className="h-4 w-4" aria-hidden />}
    </button>
  );
}

function TaskChip({ done, label, bedLabel, onToggle }: { done: boolean; label: string; bedLabel: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${label} - ${bedLabel}`}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        done ? "border-transparent bg-success text-white" : "border-input bg-background hover:bg-accent"
      )}
    >
      {done && <Check className="h-3.5 w-3.5" aria-hidden />}
      {label}
    </button>
  );
}

function DateInput({ value, today, label, onChange }: { value: string | null; today: string; label: string; onChange: (v: string | null) => void }) {
  return (
    <input
      type="date"
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn("h-8 w-36 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", DATE_TONE[dateTone(value, today)])}
    />
  );
}

function GroupTools({ bed, group, onToday, onToggleAll }: { bed: BedRecord; group: TaskGroup; onToday: () => void; onToggleAll: () => void }) {
  const { t } = useLanguage();
  const p = groupProgress(bed, group);
  const complete = p.done === p.total;
  const allLabel = complete ? t("beds_untick_all") : t("beds_tick_all");
  return (
    <div className="flex items-center gap-1">
      <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", complete ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-secondary text-secondary-foreground")}>
        {p.done}/{p.total}
      </span>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={t("beds_set_today")} aria-label={t("beds_set_today")} onClick={onToday}>
        <CalendarCheck className="h-4 w-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title={allLabel} aria-label={allLabel} onClick={onToggleAll}>
        {complete ? <RotateCcw className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function BedIdentity({ bed }: { bed: BedRecord }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-start gap-2">
      <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${ownerHue(bed.owner_name)} 65% 50%)` }} aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold leading-tight">
          {t("beds_bed_label").replace("{n}", String(bed.bed_no))}
          {bed.location && <span className="ms-2 text-xs font-normal text-muted-foreground" dir="ltr">{bed.location}</span>}
        </p>
        <p className={cn("text-sm leading-snug", !bed.patient_name && "italic text-muted-foreground")}>{bed.patient_name || t("beds_no_patient")}</p>
        {bed.owner_name && <p className="text-xs text-muted-foreground">{bed.owner_name}</p>}
        {bed.notes && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{bed.notes}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function BedsPage() {
  const { t } = useLanguage();
  const { canManage, canDo, role, profile } = useUser();
  const mayManageBeds = canDo("beds.manage");
  const { data, loading, error, setData } = useLoad(() => getRepo().listBeds());
  const pending = useRef(0); // writes in flight: a background refresh must not overwrite them

  const [search, setSearch] = useState("");
  // each team member usually works on "their" beds: remember the last owner picked on this device
  // (the first render is just <Loading />, so reading localStorage here cannot cause a hydration mismatch)
  const [owner, setOwner] = useState(() => {
    try { return typeof window === "undefined" ? "" : localStorage.getItem(OWNER_KEY) ?? ""; } catch { return ""; }
  });
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<BedStatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState<{ bed: BedRecord | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "discharge" | "delete"; bed: BedRecord } | null>(null);
  const [busy, setBusy] = useState(false);

  const pickOwner = (v: string) => {
    setOwner(v);
    try { localStorage.setItem(OWNER_KEY, v); } catch {}
  };

  const refresh = useCallback(async (showError = false) => {
    try {
      const list = await getRepo().listBeds();
      if (pending.current === 0) setData(list);
    } catch (err) {
      if (showError) toast.error(t(errorKey(err)));
    }
  }, [setData, t]);

  // other team members are ticking boxes too: pick up their changes every 30 s while the tab is visible
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const manualRefresh = async () => {
    setRefreshing(true);
    await refresh(true);
    setRefreshing(false);
  };

  /* ---------- derived data ---------- */

  const today = todayISO();
  const beds = useMemo(() => data ?? [], [data]);
  const owners = useMemo(() => [...new Set(beds.map((b) => b.owner_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")), [beds]);
  const locations = useMemo(() => [...new Set(beds.map((b) => b.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })), [beds]);
  const myBedsOwner = role === "member" && profile?.full_name && owners.includes(profile.full_name) ? profile.full_name : "";
  const activeOwner = owners.includes(owner) ? owner : myBedsOwner;

  const scoped = useMemo(() => {
    const q = normalizeArabic(search);
    return beds.filter((b) => {
      if (activeOwner && b.owner_name !== activeOwner) return false;
      if (location && b.location !== location) return false;
      if (!q) return true;
      if (/^\d+$/.test(q)) return b.bed_no === Number(q);
      return normalizeArabic(`${b.patient_name} ${b.owner_name} ${b.location}`).includes(q);
    });
  }, [beds, activeOwner, location, search]);

  const list = useMemo(() => scoped.filter((b) => matchesStatus(b, status, today)), [scoped, status, today]);

  const stats = useMemo(() => ({
    total: scoped.length,
    doctors: scoped.filter((b) => isGroupComplete(b, "doctor")).length,
    nurses: scoped.filter((b) => isGroupComplete(b, "nurse")).length,
    stale: scoped.filter((b) => isBedStale(b, today)).length,
  }), [scoped, today]);

  /* ---------- writes (optimistic: the box changes instantly, rolls back on error) ---------- */

  const patchBed = (id: string, fn: (b: BedRecord) => BedRecord) => setData((prev) => prev && prev.map((b) => (b.id === id ? fn(b) : b)));

  const mutate = async (id: string, apply: (b: BedRecord) => BedRecord, rollback: (b: BedRecord) => BedRecord, call: () => Promise<void>) => {
    patchBed(id, apply);
    pending.current++;
    try {
      await call();
    } catch (err) {
      patchBed(id, rollback);
      toast.error(t(errorKey(err)));
    } finally {
      pending.current--;
    }
  };

  const setTasks = (bed: BedRecord, patch: Record<string, boolean>) => {
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, !!bed.tasks[k]]));
    return mutate(
      bed.id,
      (b) => ({ ...b, tasks: { ...b.tasks, ...patch } }),
      (b) => ({ ...b, tasks: { ...b.tasks, ...before } }),
      () => getRepo().setBedTasks(bed.id, patch)
    );
  };
  const toggleTask = (bed: BedRecord, key: string) => setTasks(bed, { [key]: !bed.tasks[key] });
  const toggleGroup = (bed: BedRecord, group: TaskGroup) => {
    const complete = isGroupComplete(bed, group);
    return setTasks(bed, Object.fromEntries(tasksOf(group).map((d) => [d.key, !complete])));
  };
  const setDate = (bed: BedRecord, field: DateField, value: string | null) => {
    const before = bed[field];
    return mutate(
      bed.id,
      (b) => ({ ...b, [field]: value }),
      (b) => ({ ...b, [field]: before }),
      () => getRepo().updateBed(bed.id, { [field]: value })
    );
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "discharge") await getRepo().dischargeBed(confirm.bed.id);
      else await getRepo().deleteBed(confirm.bed.id);
      toast.success(t("success"));
      setConfirm(null);
      await refresh();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const exportAll = () => downloadXlsx(`beds-${today}.xlsx`, "Beds", bedsToExportRows(beds));

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;

  const bedLabel = (b: BedRecord) => t("beds_bed_label").replace("{n}", String(b.bed_no));
  const editButton = (b: BedRecord) => (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title={t("edit")} aria-label={`${t("edit")} - ${bedLabel(b)}`} onClick={() => setDialog({ bed: b })}>
      <Pencil className="h-4 w-4" />
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("beds")}
        description={t("beds_desc")}
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={manualRefresh} disabled={refreshing}>
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />{t("beds_refresh")}
            </Button>
            {beds.length > 0 && <Button type="button" variant="outline" size="sm" onClick={exportAll}><Download className="h-4 w-4" />{t("beds_export")}</Button>}
            {mayManageBeds && <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />{t("beds_import")}</Button>}
            {mayManageBeds && <Button type="button" size="sm" onClick={() => setDialog({ bed: null })}><Plus className="h-4 w-4" />{t("beds_add")}</Button>}
          </>
        }
      />

      {beds.length === 0 ? (
        <Card><CardContent className="pt-6"><EmptyState text={t("beds_empty")} /></CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("beds_stat_total")} value={stats.total} />
            <StatCard label={t("beds_stat_doctors")} value={`${stats.doctors} / ${stats.total}`} tone="success" />
            <StatCard label={t("beds_stat_nurses")} value={`${stats.nurses} / ${stats.total}`} tone="success" />
            <StatCard label={t("beds_stat_stale")} value={stats.stale} tone={stats.stale > 0 ? "warning" : "default"} hint={t("beds_stale_hint").replace("{n}", String(STALE_DAYS))} />
          </div>

          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("beds_search_ph")} aria-label={t("search")} />
              <select className={SELECT_CLASS} value={activeOwner} onChange={(e) => pickOwner(e.target.value)} aria-label={t("beds_owner")}>
                <option value="">{t("beds_all_owners")}</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <select className={SELECT_CLASS} value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t("beds_location")}>
                <option value="">{t("beds_all_locations")}</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className={SELECT_CLASS} value={status} onChange={(e) => setStatus(e.target.value as BedStatusFilter)} aria-label={t("status")}>
                {BED_STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`beds_status_${s}`)}</option>)}
              </select>
            </CardContent>
          </Card>

          {list.length === 0 ? (
            <Card><CardContent className="pt-6"><EmptyState text={t("beds_no_match")} /></CardContent></Card>
          ) : (
            <>
              {/* desktop: one dense row per bed, like the old sheet */}
              <div className="hidden max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border bg-card md:block">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead className="text-xs">
                    <tr>
                      <th rowSpan={2} className="sticky start-0 top-0 z-30 h-[4.5rem] min-w-52 bg-muted p-2 text-start font-semibold">{t("beds_col_bed")}</th>
                      {GROUPS.map(({ group }) => (
                        <th key={group} colSpan={tasksOf(group).length + 1} className="sticky top-0 z-20 h-9 border-s bg-muted p-2 text-center font-semibold">{t(`beds_group_${group}`)}</th>
                      ))}
                      <th rowSpan={2} className="sticky top-0 z-20 w-12 bg-muted p-2"><span className="sr-only">{t("actions")}</span></th>
                    </tr>
                    <tr>
                      {GROUPS.map(({ group }) => (
                        <GroupHeaderCells key={group} group={group} label={t("beds_edit_date")} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((bed) => (
                      <tr key={bed.id} className="group border-t">
                        <td className="sticky start-0 z-10 bg-card p-2 align-top group-hover:bg-muted"><BedIdentity bed={bed} /></td>
                        {GROUPS.map(({ group, dateField }) => (
                          <Fragment key={group}>
                            <td className="border-s p-2 align-top">
                              <div className="space-y-1">
                                <DateInput value={bed[dateField]} today={today} label={`${t("beds_edit_date")} - ${t(`beds_group_${group}`)} - ${bedLabel(bed)}`} onChange={(v) => setDate(bed, dateField, v)} />
                                <GroupTools bed={bed} group={group} onToday={() => setDate(bed, dateField, today)} onToggleAll={() => toggleGroup(bed, group)} />
                              </div>
                            </td>
                            {tasksOf(group).map((task) => (
                              <td key={task.key} className="px-1 py-2 text-center align-middle group-hover:bg-muted/60">
                                <TaskBox done={!!bed.tasks[task.key]} label={task.label} bedLabel={bedLabel(bed)} onToggle={() => toggleTask(bed, task.key)} />
                              </td>
                            ))}
                          </Fragment>
                        ))}
                        <td className="p-1 align-middle">{editButton(bed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* mobile: one card per bed */}
              <div className="space-y-3 md:hidden">
                {list.map((bed) => (
                  <Card key={bed.id}>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <BedIdentity bed={bed} />
                        {editButton(bed)}
                      </div>
                      {GROUPS.map(({ group, dateField }) => (
                        <section key={group} className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">{t(`beds_group_${group}`)}</h3>
                            <div className="flex flex-wrap items-center gap-2">
                              <DateInput value={bed[dateField]} today={today} label={`${t("beds_edit_date")} - ${t(`beds_group_${group}`)}`} onChange={(v) => setDate(bed, dateField, v)} />
                              <GroupTools bed={bed} group={group} onToday={() => setDate(bed, dateField, today)} onToggleAll={() => toggleGroup(bed, group)} />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {tasksOf(group).map((task) => (
                              <TaskChip key={task.key} done={!!bed.tasks[task.key]} label={task.label} bedLabel={bedLabel(bed)} onToggle={() => toggleTask(bed, task.key)} />
                            ))}
                          </div>
                        </section>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <BedDialog
        open={dialog !== null}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
        bed={dialog?.bed ?? null}
        owners={owners}
        locations={locations}
        canManage={canManage}
        onSaved={() => void refresh()}
        onAskDischarge={(b) => { setDialog(null); setConfirm({ kind: "discharge", bed: b }); }}
        onAskDelete={(b) => { setDialog(null); setConfirm({ kind: "delete", bed: b }); }}
      />
      <BedImportDialog open={importOpen} onOpenChange={setImportOpen} existing={beds} onDone={() => void refresh()} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.kind === "delete" ? t("beds_delete_title") : t("beds_discharge_title")}
        description={confirm?.kind === "delete" ? t("beds_delete_desc") : t("beds_discharge_desc")}
        confirmLabel={confirm?.kind === "delete" ? t("beds_delete") : t("beds_discharge")}
        destructive
        busy={busy}
        onConfirm={doConfirm}
      />
    </div>
  );
}

/* ---------- table helpers ---------- */

/** Header cells of one group's second row: the last-edit date column followed by one column per task. */
function GroupHeaderCells({ group, label }: { group: TaskGroup; label: string }) {
  return (
    <>
      <th className="sticky top-9 z-20 h-9 min-w-40 border-s bg-muted p-1 font-medium">{label}</th>
      {tasksOf(group).map((task) => (
        <th key={task.key} className="sticky top-9 z-20 h-9 min-w-16 bg-muted px-1 py-1 font-medium">{task.label}</th>
      ))}
    </>
  );
}
