"use client";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/shared";
import { exportDemoData, resetDemoData } from "@/lib/repo/demo";

export default function SettingsPage() {
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { profile, role, mode, canManage } = useUser();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const downloadBackup = () => {
    const blob = new Blob([exportDemoData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `his-demo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t("settings")} />

      <Card>
        <CardHeader><CardTitle>{t("settings_profile")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="font-medium">{profile?.full_name}</p>
          {profile?.email && <p className="text-sm text-muted-foreground" dir="ltr">{profile.email}</p>}
          {role && <Badge variant="info">{t(`role_${role}`)}</Badge>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("settings_appearance")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t("theme")}</Label>
            <Button variant="outline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? t("dark") : t("light")}</Button>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("language")}</Label>
            <Button variant="outline" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{lang === "ar" ? t("arabic") : t("english")}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{t("data_mode")} <Badge variant={mode === "live" ? "success" : "warning"}>{mode === "live" ? t("mode_live") : t("mode_demo")}</Badge></CardTitle>
          <CardDescription>{mode === "live" ? t("mode_live_desc") : t("mode_demo_desc")}</CardDescription>
        </CardHeader>
        {mode === "demo" && canManage && (
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadBackup}>{t("download_backup")}</Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>{t("reset_demo_data")}</Button>
          </CardContent>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("reset_demo_data")}
        description={t("reset_demo_warning")}
        confirmLabel={t("reset_demo_data")}
        destructive
        onConfirm={() => {
          resetDemoData();
          toast.success(t("success"));
          setConfirmOpen(false);
          window.location.assign("/dashboard");
        }}
      />
    </div>
  );
}
