"use client";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";

export default function AccessDeniedPage() {
  const { t } = useLanguage();
  const { role } = useUser();
  const home = role === "member" ? "/my-tasks" : "/dashboard";
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <p className="text-xs font-semibold tracking-widest text-muted-foreground">403</p>
      <h1 className="max-w-md text-xl font-semibold">{t("access_denied")}</h1>
      <Link href={home} className="mt-2"><Button variant="outline">{role === "member" ? t("my_tasks") : t("dashboard")}</Button></Link>
    </div>
  );
}
