"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRepo } from "@/lib/repo";
import { errorKey } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { BedRecord } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = add a new bed */
  bed: BedRecord | null;
  owners: string[];
  locations: string[];
  canManage: boolean;
  onSaved: () => void;
  onAskDischarge: (bed: BedRecord) => void;
  onAskDelete: (bed: BedRecord) => void;
}

export function BedDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* DialogContent only exists while open, so BedForm starts from fresh props every time */}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <BedForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function BedForm({ onOpenChange, bed, owners, locations, canManage, onSaved, onAskDischarge, onAskDelete }: Props) {
  const { t, lang } = useLanguage();
  const [location, setLocation] = useState(bed?.location ?? "");
  const [bedNo, setBedNo] = useState(bed ? String(bed.bed_no) : "");
  const [owner, setOwner] = useState(bed?.owner_name ?? "");
  const [patient, setPatient] = useState(bed?.patient_name ?? "");
  const [notes, setNotes] = useState(bed?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = Number(bedNo);
    if (!Number.isInteger(n) || n < 1) { toast.error(t("err_invalid_bed")); return; }
    setSaving(true);
    try {
      const repo = getRepo();
      if (bed) await repo.updateBed(bed.id, { location, bed_no: n, owner_name: owner, patient_name: patient, notes });
      else await repo.createBed({ location, bed_no: n, owner_name: owner, patient_name: patient, notes });
      toast.success(t("success"));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{bed ? t("beds_edit") : t("beds_add")}</DialogTitle>
        <DialogDescription>
          {bed?.updated_by_name ? t("beds_updated_by").replace("{name}", `${bed.updated_by_name} (${formatDateTime(bed.updated_at, lang)})`) : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bed-location">{t("beds_location")}</Label>
          <Input id="bed-location" list="bed-locations" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("beds_location_ph")} dir="ltr" />
          <datalist id="bed-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bed-no">{t("beds_bed_no")}</Label>
          <Input id="bed-no" type="number" min={1} inputMode="numeric" value={bedNo} onChange={(e) => setBedNo(e.target.value)} dir="ltr" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bed-owner">{t("beds_owner")}</Label>
          <Input id="bed-owner" list="bed-owners" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <datalist id="bed-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bed-patient">{t("beds_patient")}</Label>
          <Input id="bed-patient" value={patient} onChange={(e) => setPatient(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bed-notes">{t("beds_notes")}</Label>
          <Textarea id="bed-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </div>

      {bed && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button type="button" variant="outline" size="sm" onClick={() => onAskDischarge(bed)}>{t("beds_discharge")}</Button>
          {canManage && <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => onAskDelete(bed)}>{t("beds_delete")}</Button>}
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
        <Button type="button" onClick={save} disabled={saving}>{t("save")}</Button>
      </DialogFooter>
    </>
  );
}
