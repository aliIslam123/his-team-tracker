"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Pencil, Plus, UserRound } from "lucide-react";
import { useLoad } from "@/hooks/use-load";
import { useRequirePermission } from "@/hooks/use-require-permission";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, Loading, EmptyState } from "@/components/shared";
import { getRepo } from "@/lib/repo";
import { errorKey } from "@/lib/errors";
import { can, PERMISSION_KEYS, PERMISSION_LABEL_KEY, ROLE_PERMISSION_DEFAULTS, SUPER_ONLY_PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import type { Role, UserAccount } from "@/lib/types";

const ROLE_KEYS: Record<Role, string> = {
  super_admin: "role_super_admin",
  hospital_admin: "role_hospital_admin",
  supervisor: "role_supervisor",
  member: "role_member",
};

const ALL_ROLES: Role[] = ["super_admin", "hospital_admin", "supervisor", "member"];

/** Keys an admin may toggle on another user (the super-only ones are never editable here). */
const TOGGLEABLE: PermissionKey[] = PERMISSION_KEYS.filter(
  (k) => !(SUPER_ONLY_PERMISSIONS as string[]).includes(k)
);

/** WYSIWYG: the effective permissions of an account, ready to fill the checkboxes. */
function effectivePerms(u: UserAccount): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of TOGGLEABLE) out[k] = can(u.role, k, u.permissions);
  return out;
}

/** The password dialog: shown exactly once, right after creating an account or resetting a password. */
function PasswordDialog({ password, onClose }: { password: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const { mode } = useUser();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password ?? "");
      toast.success(t("copied"));
    } catch {
      toast.error(t("error"));
    }
  };
  return (
    <Dialog open={!!password} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("password_once_title")}</DialogTitle>
          <DialogDescription>{t("user_password_warning")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input readOnly value={password ?? ""} dir="ltr" className="font-mono" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" onClick={copy}>
              <Copy className="h-4 w-4" /> {t("copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("user_password_hint")}</p>
          {mode === "demo" && <p className="text-xs text-muted-foreground">{t("demo_users_hint")}</p>}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** hospital_admin + super_admin: create engineer accounts, set roles, deactivate, reset passwords. */
export default function UsersAdminPage() {
  const allowed = useRequirePermission("users.manage");
  const { t } = useLanguage();
  const { isSuper, profile, hospitals } = useUser();

  // hospital_admin is bound to their own hospital; super_admin picks one
  const [hospitalSel, setHospitalSel] = useState<string>("");
  const effectiveHospital = isSuper ? hospitalSel : profile?.hospital_id ?? "";

  const { data: users, loading, reload } = useLoad(
    () => getRepo().listUsers(effectiveHospital || undefined),
    [effectiveHospital],
    allowed && !!effectiveHospital
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", full_name: "", job_title: "", role: "member" as Role, must_change_password: true });
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [edit, setEdit] = useState<UserAccount | null>(null);
  const [permState, setPermState] = useState<Record<string, boolean>>({});
  const [showPerms, setShowPerms] = useState(false);
  const [deactivate, setDeactivate] = useState<UserAccount | null>(null);
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);

  if (!allowed) return <Loading />;

  // hospital_admin may only hand out supervisor / member
  const roleOptions: Role[] = isSuper ? ALL_ROLES : ["supervisor", "member"];

  const submitCreate = async () => {
    if (!effectiveHospital) { toast.error(t("select_hospital")); return; }
    setBusy(true);
    try {
      const res = await getRepo().createUser({
        hospital_id: effectiveHospital,
        username: form.username.trim().toLowerCase(),
        full_name: form.full_name,
        job_title: form.job_title.trim() || null,
        role: form.role,
        must_change_password: form.must_change_password,
      });
      setCreateOpen(false);
      setForm({ username: "", full_name: "", job_title: "", role: "member", must_change_password: true });
      setShownPassword(res.password);
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (u: UserAccount) => {
    setEdit(u);
    setPermState(effectivePerms(u));
    setShowPerms(false);
  };

  const submitEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await getRepo().updateUser(edit.id, {
        full_name: edit.full_name,
        job_title: edit.job_title,
        role: edit.role,
        // WYSIWYG overrides: what the checkboxes show is exactly what gets stored
        permissions: permState,
      });
      toast.success(t("saved"));
      setEdit(null);
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const submitDeactivate = async () => {
    if (!deactivate) return;
    setBusy(true);
    try {
      await getRepo().updateUser(deactivate.id, { is_active: !deactivate.is_active });
      toast.success(t("saved"));
      setDeactivate(null);
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      const res = await getRepo().resetUserPassword(resetTarget.id);
      setResetTarget(null);
      setShownPassword(res.password);
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title={t("users")}
        description={t("demo_users_hint")}
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={!effectiveHospital}>
            <Plus className="h-4 w-4" /> {t("add_user")}
          </Button>
        }
      />

      {/* hospital picker (super_admin) / fixed label (hospital_admin) */}
      <div className="mb-4 max-w-sm space-y-1">
        {isSuper ? (
          <>
            <Label htmlFor="u-hospital">{t("select_hospital")}</Label>
            <Select value={hospitalSel} onValueChange={setHospitalSel}>
              <SelectTrigger id="u-hospital"><SelectValue placeholder={t("select_hospital")} /></SelectTrigger>
              <SelectContent>
                {hospitals.map((h) => (
                  <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("hospital")}: {hospitals.find((h) => h.id === profile?.hospital_id)?.name ?? "—"}
          </p>
        )}
      </div>

      {!effectiveHospital ? (
        <EmptyState text={t("select_hospital")} />
      ) : loading ? (
        <Loading />
      ) : !users || users.length === 0 ? (
        <EmptyState text={t("no_users")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start">{t("username")}</th>
                <th className="p-3 text-start">{t("user_full_name")}</th>
                <th className="p-3 text-start">{t("job_title")}</th>
                <th className="p-3 text-start">{t("role")}</th>
                <th className="p-3 text-start">{t("status")}</th>
                <th className="p-3 text-start">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className={u.is_active ? "" : "opacity-60"}>
                  <td className="p-3 font-mono text-xs" dir="ltr">{u.username ?? "—"}</td>
                  <td className="p-3 font-medium">{u.full_name}</td>
                  <td className="p-3">{u.job_title ?? "—"}</td>
                  <td className="p-3">{t(ROLE_KEYS[u.role])}</td>
                  <td className="p-3">
                    <Badge variant={u.is_active ? "success" : "secondary"}>{u.is_active ? t("active") : t("inactive")}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(u)}>
                        <Pencil className="h-4 w-4" /> {t("edit")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setResetTarget(u)}>
                        <KeyRound className="h-4 w-4" /> {t("reset_password")}
                      </Button>
                      <Button
                        type="button"
                        variant={u.is_active ? "ghost" : "outline"}
                        size="sm"
                        onClick={() => setDeactivate(u)}
                      >
                        <UserRound className="h-4 w-4" /> {u.is_active ? t("deactivate") : t("activate")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* create account */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add_user")}</DialogTitle>
            <DialogDescription>{t("user_password_hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="u-username">{t("username")}</Label>
              <Input id="u-username" dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t("username_ph")} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-name">{t("user_full_name")}</Label>
              <Input id="u-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-title">{t("job_title")}</Label>
              <Input id="u-title" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t("select_role")}</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{t(ROLE_KEYS[r])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.must_change_password}
                onCheckedChange={(v) => setForm({ ...form, must_change_password: v === true })}
              />
              {t("must_change_password")}
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={submitCreate} disabled={busy}>{t("create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* edit account (name / job title / role) */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("edit_user")}</DialogTitle>
            <DialogDescription dir="ltr">{edit?.username}</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="e-name">{t("user_full_name")}</Label>
                <Input id="e-name" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="e-title">{t("job_title")}</Label>
                <Input id="e-title" value={edit.job_title ?? ""} onChange={(e) => setEdit({ ...edit, job_title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("select_role")}</Label>
                <Select
                  value={edit.role}
                  onValueChange={(v) => {
                    const role = v as Role;
                    setEdit({ ...edit, role });
                    // switching role resets the checkboxes to the new role's defaults
                    setPermState(effectivePerms({ ...edit, role, permissions: null }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>{t(ROLE_KEYS[r])}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* permission overrides — defaults come from the role; toggles are saved for this user only */}
              {edit.role !== "super_admin" && (
                <div className="space-y-2 rounded-lg border p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-sm font-medium"
                    onClick={() => setShowPerms((v) => !v)}
                  >
                    {t("permissions")}
                    <span className="text-xs text-muted-foreground">{showPerms ? "−" : "+"}</span>
                  </button>
                  {showPerms && (
                    <>
                      <p className="text-xs text-muted-foreground">{t("permissions_hint")}</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {TOGGLEABLE.map((k) => (
                          <label key={k} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={permState[k] === true}
                              onCheckedChange={(v) => setPermState({ ...permState, [k]: v === true })}
                            />
                            {t(PERMISSION_LABEL_KEY[k])}
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_PERMISSION_DEFAULTS[edit.role].length} {t("perm_by_default")}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={submitEdit} disabled={busy}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* deactivate / activate */}
      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title={deactivate?.is_active ? t("deactivate") : t("activate")}
        description={deactivate?.is_active ? t("deactivate_warning") : undefined}
        destructive={!!deactivate?.is_active}
        busy={busy}
        onConfirm={submitDeactivate}
      />

      {/* reset password */}
      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(o) => !o && setResetTarget(null)}
        title={t("reset_password")}
        description={t("reset_password_confirm")}
        busy={busy}
        onConfirm={submitReset}
      />

      {/* password shown once */}
      <PasswordDialog password={shownPassword} onClose={() => setShownPassword(null)} />
    </div>
  );
}
