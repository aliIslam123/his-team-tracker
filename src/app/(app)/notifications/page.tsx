"use client";
import Link from "next/link";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Loading, PageHeader } from "@/components/shared";
import { useLoad } from "@/hooks/use-load";
import { getRepo } from "@/lib/repo";
import { formatDateTime } from "@/lib/format";
import { errorKey } from "@/lib/errors";

export default function NotificationsPage() {
  const { t, lang } = useLanguage();
  const { data, loading, error, reload } = useLoad(() => getRepo().listNotifications());

  const act = async (fn: () => Promise<void>) => {
    try { await fn(); reload(); } catch (err) { toast.error(t(errorKey(err))); }
  };

  if (loading) return <Loading />;
  if (error) return <p className="p-4 text-destructive">{t("error")}</p>;
  const items = data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("notifications")}
        actions={<Button variant="outline" onClick={() => act(() => getRepo().markAllNotificationsRead())} disabled={!items.some((n) => !n.is_read)}>{t("mark_all_read")}</Button>}
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
    </div>
  );
}
