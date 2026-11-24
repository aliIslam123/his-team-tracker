"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/env";
import { clearDemoMustChangePassword, readDemoSessionUser } from "@/lib/repo/demo";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Standalone page: an engineer changes the password an admin gave them (or after an admin reset). */
export default function ChangePasswordPage() {
  const { t } = useLanguage();
  const { loading, isAuthed, mustChangePassword, refreshProfile } = useUser();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // not signed in → login
  useEffect(() => {
    if (!loading && !isAuthed) router.replace("/login");
  }, [loading, isAuthed, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError(t("password_too_short")); return; }
    if (password !== confirm) { setError(t("password_mismatch")); return; }
    setBusy(true);
    try {
      if (hasSupabaseEnv()) {
        const { error: updErr } = await createClient().auth.updateUser({ password });
        if (updErr) throw updErr;
        // clear the forced flag — the DB trigger only allows true → false on this column
        const { error: pErr } = await createClient()
          .from("profiles")
          .update({ must_change_password: false })
          .eq("id", (await createClient().auth.getUser()).data.user?.id ?? "");
        if (pErr) throw pErr;
      } else {
        // demo: update the local account and clear the flag
        clearDemoMustChangePassword(readDemoSessionUser()?.id ?? "", password);
      }
      await refreshProfile();
      toast.success(t("password_changed"));
      router.replace(mustChangePassword ? "/dashboard" : "/settings");
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="حلول كامل" className="mx-auto mb-2 h-16 w-auto max-w-[280px] object-contain" />
          <p className="text-sm text-muted-foreground">{t("change_password")}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("change_password")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">{t("change_password_desc")}</p>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1">
                <Label htmlFor="password">{t("new_password")}</Label>
                <Input id="password" type="password" autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">{t("confirm_password")}</Label>
                <Input id="confirm" type="password" autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? t("loading") : t("save")}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
