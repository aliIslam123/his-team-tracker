"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, ExternalLink, Pencil, Plus } from "lucide-react";
import { useLoad } from "@/hooks/use-load";
import { useRequireRole } from "@/hooks/use-require-role";
import { useLanguage } from "@/components/providers/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader, Loading, EmptyState } from "@/components/shared";
import { getRepo } from "@/lib/repo";
import { slugifyName } from "@/lib/slug";
import { errorKey } from "@/lib/errors";
import type { Hospital } from "@/lib/types";

/** super_admin: every hospital of the system (add / rename / enable-disable) + its public form link. */
export default function HospitalsAdminPage() {
  const allowed = useRequireRole(["super_admin"]);
  const { t } = useLanguage();
  const { data: hospitals, loading, reload } = useLoad(() => getRepo().listHospitals(), [], allowed);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Hospital | null>(null);
  const [editName, setEditName] = useState("");
  const [toggle, setToggle] = useState<Hospital | null>(null);

  if (!allowed) return <Loading />;

  const formLink = (h: Hospital) => `${typeof window !== "undefined" ? window.location.origin : ""}/h/${h.slug}`;

  const copyLink = async (h: Hospital) => {
    try {
      await navigator.clipboard.writeText(formLink(h));
      toast.success(t("copied"));
    } catch {
      toast.error(t("error"));
    }
  };

  const submitAdd = async () => {
    if (name.replace(/\s+/g, " ").trim().length < 2) { toast.error(t("err_invalid_name")); return; }
    setBusy(true);
    try {
      const h = await getRepo().createHospital(name);
      toast.success(`${t("add_hospital")}: ${h.name} (${h.slug})`);
      setAddOpen(false);
      setName("");
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!edit) return;
    const clean = editName.replace(/\s+/g, " ").trim();
    if (clean.length < 2) { toast.error(t("err_invalid_name")); return; }
    setBusy(true);
    try {
      await getRepo().updateHospital(edit.id, { name: clean });
      toast.success(t("saved"));
      setEdit(null);
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const submitToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try {
      await getRepo().updateHospital(toggle.id, { is_active: !toggle.is_active });
      toast.success(t("saved"));
      setToggle(null);
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
        title={t("hospitals")}
        description={t("hospital_slug_hint")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> {t("add_hospital")}
          </Button>
        }
      />

      {loading ? (
        <Loading />
      ) : !hospitals || hospitals.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-start text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start">{t("hospital_name")}</th>
                <th className="p-3 text-start">{t("hospital_slug")}</th>
                <th className="p-3 text-start">{t("hospital_form_link")}</th>
                <th className="p-3 text-start">{t("status")}</th>
                <th className="p-3 text-start">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hospitals.map((h) => (
                <tr key={h.id}>
                  <td className="p-3 font-medium">{h.name}</td>
                  <td className="p-3" dir="ltr">{h.slug}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <code className="rounded bg-muted px-2 py-1 text-xs" dir="ltr">/h/{h.slug}</code>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyLink(h)} aria-label={t("copy")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Link href={`/h/${h.slug}`} target="_blank" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent" aria-label={t("view")}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant={h.is_active ? "success" : "secondary"}>{h.is_active ? t("hospital_active") : t("hospital_inactive")}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => { setEdit(h); setEditName(h.name); }}>
                        <Pencil className="h-4 w-4" /> {t("edit")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setToggle(h)}>
                        {h.is_active ? t("hospital_disable") : t("hospital_enable")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* add */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add_hospital")}</DialogTitle>
            <DialogDescription>{t("hospital_slug_hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="h-name">{t("hospital_name")}</Label>
            <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("hospital_name_ph")} />
            {name.trim() && (
              <p className="text-xs text-muted-foreground" dir="ltr">{t("hospital_slug")}: {slugifyName(name)}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={submitAdd} disabled={busy}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* rename */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("edit_hospital")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="h-edit">{t("hospital_name")}</Label>
            <Input id="h-edit" value={editName} onChange={(e) => setEditName(e.target.value)} />
            {edit && <p className="text-xs text-muted-foreground" dir="ltr">{t("hospital_slug")}: {edit.slug}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={submitEdit} disabled={busy}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* enable / disable */}
      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.is_active ? t("hospital_disable") : t("hospital_enable")}
        description={toggle?.is_active ? t("hospital_disable_warning") : undefined}
        busy={busy}
        onConfirm={submitToggle}
      />
    </div>
  );
}
