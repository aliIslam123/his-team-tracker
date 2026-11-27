"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loginSchema } from "@/lib/validations";

/** Only same-site relative paths are accepted as the post-login target (prevents open redirects). */
function safeNext(fallback = "/dashboard"): string {
  try {
    const n = new URLSearchParams(window.location.search).get("next");
    return n && n.startsWith("/") && !n.startsWith("//") ? n : fallback;
  } catch {
    return fallback;
  }
}

export default function LoginPage() {
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { mode, isAuthed, loading, role, signIn } = useUser();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Members have no admin dashboard: send them straight to their own tasks.
  useEffect(() => {
    if (!loading && isAuthed) router.replace(safeNext(role === "member" ? "/my-tasks" : "/dashboard"));
  }, [loading, isAuthed, role, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) { setError(t("login_required")); return; }
    setBusy(true);
    const res = await signIn(identifier, password);
    setBusy(false);
    if (!res.ok) { setError(t(res.error ?? "invalid_credentials")); return; }
    router.replace(safeNext(role === "member" ? "/my-tasks" : "/dashboard"));
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-32 end-[-10%] h-80 w-80 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-40 start-[-10%] h-80 w-80 rounded-full bg-info/10 blur-3xl" aria-hidden />
      <div className="absolute end-4 top-4 z-10 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>{lang === "ar" ? "English" : "العربية"}</Button>
        <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme")}>
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
      <div className="relative w-full max-w-md space-y-4">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Holool His" className="mx-auto mb-2 h-16 w-auto max-w-[280px] object-contain" />
          <p className="text-sm text-muted-foreground">{t("login")}</p>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("sign_in")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1">
                <Label htmlFor="identifier">{t("username")}</Label>
                <Input id="identifier" name="identifier" autoComplete="username" dir="ltr" value={identifier} onChange={(e) => setIdentifier(e.target.value)} type="text" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">{t("password")}</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? t("loading") : t("sign_in")}</Button>
            </form>
          </CardContent>
        </Card>
        {mode === "demo" && <p className="text-center text-xs text-muted-foreground">{t("demo_login_hint")}</p>}
        <p className="text-center text-xs text-muted-foreground">{t("login_username_hint")}</p>
      </div>
    </div>
  );
}
