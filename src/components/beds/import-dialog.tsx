"use client";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getRepo } from "@/lib/repo";
import { errorKey } from "@/lib/errors";
import { parseBedSheet, type BedSheetParse } from "@/lib/beds";
import type { BedRecord } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: BedRecord[];
  onDone: () => void;
}

const keyOf = (location: string, bed_no: number) => `${location.toLowerCase()}|${bed_no}`;

export function BedImportDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* DialogContent only exists while open, so a previous file's preview never lingers */}
      <DialogContent>
        <ImportBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ImportBody({ onOpenChange, existing, onDone }: Props) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<(BedSheetParse & { fileName: string }) | null>(null);

  const counts = useMemo(() => {
    if (!parsed) return { fresh: 0, overwritten: 0 };
    const have = new Set(existing.map((b) => keyOf(b.location, b.bed_no)));
    const overwritten = parsed.rows.filter((r) => have.has(keyOf(r.location, r.bed_no))).length;
    return { fresh: parsed.rows.length - overwritten, overwritten };
  }, [parsed, existing]);

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      let result: BedSheetParse = { rows: [], skipped: 0, duplicates: 0, error: "no_header" };
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = (await file.text()).replace(/^\uFEFF/, "");
        result = parseBedSheet(Papa.parse(text, { skipEmptyLines: true }).data as unknown[][]);
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer());
        // sheets are converted one at a time and the first one that looks like the follow-up sheet wins
        for (const name of wb.SheetNames) {
          const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
          const r = parseBedSheet(grid);
          if (r.rows.length) { result = r; break; }
          if (!r.error) result = r;
        }
      }
      if (result.error) { toast.error(t("beds_import_no_header")); setParsed(null); return; }
      if (!result.rows.length) { toast.error(t("beds_import_empty")); setParsed(null); return; }
      setParsed({ ...result, fileName: file.name });
    } catch {
      toast.error(t("error"));
      setParsed(null);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const res = await getRepo().importBeds(parsed.rows, parsed.fileName);
      toast.success(t("beds_import_done").replace("{c}", String(res.created)).replace("{u}", String(res.updated)));
      if (res.failed > 0) toast.error(`${t("error")}: ${res.failed}`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("beds_import_title")}</DialogTitle>
        <DialogDescription>{t("beds_import_desc")}</DialogDescription>
      </DialogHeader>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        aria-label={t("beds_import")}
        disabled={parsing || importing}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
      />
      {parsing && <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>}

      {parsed && (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" role="status">
          <p className="font-semibold">{t("beds_import_ready").replace("{n}", String(parsed.rows.length))}</p>
          <p>{t("beds_import_new").replace("{n}", String(counts.fresh))}</p>
          <p>{t("beds_import_existing").replace("{n}", String(counts.overwritten))}</p>
          {parsed.skipped > 0 && <p className="text-muted-foreground">{t("beds_import_skipped").replace("{n}", String(parsed.skipped))}</p>}
          {counts.overwritten > 0 && <p className="pt-1 text-warning">{t("beds_import_overwrite").replace("{n}", String(counts.overwritten))}</p>}
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>{t("cancel")}</Button>
        <Button type="button" onClick={run} disabled={!parsed || importing}>{t("beds_import_confirm")}</Button>
      </DialogFooter>
    </>
  );
}
