"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getRepo } from "@/lib/repo";
import { JOB_TYPES, staffSchema } from "@/lib/validations";
import type { Department, JobType, StaffInput, StaffMember } from "@/lib/types";

export interface StaffFormValues extends StaffInput {
  is_active: boolean;
}

interface Props {
  initial?: StaffMember;
  busy?: boolean;
  onSubmit: (values: StaffFormValues) => void | Promise<void>;
  onCancel: () => void;
}

const NONE = "none";

/** Shared by "add staff" and "edit staff" so both validate and behave identically. */
export function StaffForm({ initial, busy, onSubmit, onCancel }: Props) {
  const { t, lang } = useLanguage();
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [jobType, setJobType] = useState<string>(initial?.job_type ?? "");
  const [deptId, setDeptId] = useState<string>(initial?.department_id ?? NONE);
  const [hisId, setHisId] = useState(initial?.his_user_id ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    getRepo().listDepartments().then(setDepartments).catch(() => {});
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = staffSchema.safeParse({
      full_name: fullName,
      job_type: jobType,
      department_id: deptId === NONE ? null : deptId,
      his_user_id: hisId.trim() || null,
    });
    if (!parsed.success) { toast.error(t("staff_form_invalid")); return; }
    onSubmit({
      full_name: parsed.data.full_name,
      job_type: parsed.data.job_type as JobType,
      department_id: parsed.data.department_id ?? null,
      his_user_id: parsed.data.his_user_id ?? null,
      is_active: isActive,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="sf-name">{t("full_name")} *</Label>
        <Input id="sf-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>{t("job_type")} *</Label>
        <Select value={jobType} onValueChange={setJobType}>
          <SelectTrigger aria-label={t("job_type")}><SelectValue placeholder={t("job_type")} /></SelectTrigger>
          <SelectContent>
            {JOB_TYPES.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t("department")}</Label>
        <Select value={deptId} onValueChange={setDeptId}>
          <SelectTrigger aria-label={t("department")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("no_department")}</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{lang === "ar" ? d.name_ar : d.name_en}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sf-his">{t("his_user_id")}</Label>
        <Input id="sf-his" dir="ltr" value={hisId} onChange={(e) => setHisId(e.target.value)} />
      </div>
      {initial && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          {t("is_active")}
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? t("loading") : t("save")}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
      </div>
    </form>
  );
}
