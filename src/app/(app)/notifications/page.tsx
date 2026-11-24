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
  const { role } = useUser();
  const canSend = can(role, "notifications.send");

  const { data, loading, error, reload } = useLoad(() => getRepo().listNotifications());
  const { data: users } = useLoad(() => getRepo().listUsers(), [], canSend);

  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    try { await fn(); reload(); } catch (err) { toast.error(t(errorKey(err))); }
  };

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error(t("notification_required")); return; }
    const all = users ?? [];
    const targets = recipient === "all" ? all.filter((u) => u.is_active) : all.filter((u) => u.id === recipient);
    if (targets.length === 0) { toast.error(t("no_recipients")); return; }
    setBusy(true);
    try {
      for (const u of targets) {
        await getRepo().sendNotification({ recipientId: u.id, title: title.trim(), body: body.trim() });
      }
      toast.success(t("notification_sent"));
      setSendOpen(false);
      setTitle("");
      setBody("");
      setRecipient("all");
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

      {/* send a message to the team (manager only) */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("send_notification")}</DialogTitle>
            <DialogDescription>{t("notification_body_ph")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("notification_recipient")}</Label>
              <Select value={recipient} onValueChange={setRecipient}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("all_users")}</SelectItem>
                  {(users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.username ?? "—"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("notification_title")}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("notification_title_ph")} />
            </div>
            <div className="space-y-1">
              <Label>{t("notification_body")}</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("notification_body_ph")} rows={5} />
            </div>
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
