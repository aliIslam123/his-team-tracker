"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Loading, PageHeader } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { errorKey } from "@/lib/errors";

export default function NotificationsPage() {
  const { t, lang } = useLanguage();
  const { role, isSuper, hospitals } = useUser();
  const canSend = can(role, "notifications.send");

  const { data, loading, error, reload } = useLoad(() => getRepo().listNotifications());

  // The super_admin can address every hospital; other managers are scoped to their own hospital by RLS/demo.
  const hospitalsKey = hospitals.map((h) => h.id).join(",");
  const { data: users } = useLoad(async () => {
    if (isSuper && hospitals.length) {
      const lists = await Promise.all(hospitals.map((h) => getRepo().listUsers(h.id)));
      return lists.flat();
    }
    return getRepo().listUsers();
  }, [isSuper, hospitalsKey], canSend);

  const [sendOpen, setSendOpen] = useState(false);
  const [mode, setMode] = useState("all");
  const [recipient, setRecipient] = useState("");
  const [teamHospital, setTeamHospital] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    try { await fn(); reload(); } catch (err) { toast.error(t(errorKey(err))); }
  };

  const candidates = (users ?? []).filter((u) => u.is_active);
  const hospitalName = (id: string | null) => hospitals.find((h) => h.id === id)?.name ?? "—";
  const isHospitalMode = mode.startsWith("hospital:");
  const teamUsers = teamHospital === "all" ? candidates : candidates.filter((u) => u.hospital_id === teamHospital);
  const targets = mode === "all"
    ? candidates
    : isHospitalMode
      ? candidates.filter((u) => u.hospital_id === mode.slice("hospital:".length))
      : mode === "person"
        ? recipient === "all" ? teamUsers : teamUsers.filter((u) => u.id === recipient)
        : candidates.filter((u) => selected.includes(u.id));
  // super_admin stamps the chosen hospital (or null = all); others let the repo use their own hospital.
  const hospitalForSend = isSuper
    ? (isHospitalMode ? mode.slice("hospital:".length) : mode === "person" && teamHospital !== "all" ? teamHospital : null)
    : undefined;

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error(t("notification_required")); return; }
    if (targets.length === 0) { toast.error(t("no_recipients")); return; }
    setBusy(true);
    try {
      for (const u of targets) {
        await getRepo().sendNotification({ recipientId: u.id, title: title.trim(), body: body.trim(), hospitalId: hospitalForSend });
      }
      toast.success(t("notification_sent"));
      setSendOpen(false);
      setTitle("");
      setBody("");
      setRecipient("");
      setTeamHospital("all");
      setSelected([]);
      setMode("all");
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;
  const items = data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("notifications")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canSend && (
              <Button onClick={() => setSendOpen(true)}>
                <Send className="h-4 w-4" /> {t("send_notification")}
              </Button>
            )}
            <Button variant="outline" onClick={() => act(() => getRepo().markAllNotificationsRead())} disabled={!items.some((n) => !n.is_read)}>{t("mark_all_read")}</Button>
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? <EmptyState /> : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className={n.is_read ? "opacity-70" : ""}>
                    <p className="font-medium">
                      {n.link ? (
                        <Link href={n.link} onClick={() => { if (!n.is_read) getRepo().markNotificationRead(n.id).catch(() => {}); }} className="hover:underline">{n.title}</Link>
                      ) : n.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{n.body}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at, lang)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!n.is_read && <Badge variant="info">{t("new_label")}</Badge>}
                    {!n.is_read && <Button size="sm" variant="outline" onClick={() => act(() => getRepo().markNotificationRead(n.id))}>{t("mark_read")}</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* send a message — super_admin can target hospitals, one person, or a picked list */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("send_notification")}</DialogTitle>
            <DialogDescription>{t("notification_body_ph")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("notification_recipient")}</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isSuper ? t("send_to_all_hospitals") : t("all_users")}</SelectItem>
                  {isSuper && hospitals.map((h) => (
                    <SelectItem key={h.id} value={`hospital:${h.id}`}>{t("send_to_hospital")}: {h.name}</SelectItem>
                  ))}
                  <SelectItem value="person">{t("send_to_person")}</SelectItem>
                  <SelectItem value="selected">{t("send_to_selected")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "person" && (
              <>
                <div className="space-y-1">
                  <Label>{t("notification_recipient")}</Label>
                  <Select value={teamHospital} onValueChange={setTeamHospital}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("send_to_all_hospitals")}</SelectItem>
                      {hospitals.map((h) => (
                        <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{t("send_to_person")}</Label>
                  <Select value={recipient} onValueChange={setRecipient}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("all_team_members")}</SelectItem>
                      {teamUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.username ?? "—"}){isSuper && ` · ${hospitalName(u.hospital_id)}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {mode === "selected" && (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
                {candidates.length === 0 && <p className="text-sm text-muted-foreground">{t("no_recipients")}</p>}
                {candidates.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(u.id)}
                      onCheckedChange={(v) => setSelected((prev) => v === true ? [...prev, u.id] : prev.filter((id) => id !== u.id))}
                    />
                    <span>{u.full_name} ({u.username ?? "—"}){isSuper && ` · ${hospitalName(u.hospital_id)}`}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <Label>{t("notification_title")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("notification_title_ph")} />
            </div>
            <div className="space-y-1">
              <Label>{t("notification_body")}</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("notification_body_ph")} rows={5} />
            </div>
            <p className="text-xs text-muted-foreground">{t("all_users")}: {targets.length}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={busy}>{t("cancel")}</Button>
            <Button onClick={send} disabled={busy}>{t("send_notification")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
