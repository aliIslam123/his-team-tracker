"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";

export default function AccessDeniedPage() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-bold">403</h1>
      <p className="text-muted-foreground">{t("access_denied")}</p>
      <Link href="/dashboard"><Button>{t("dashboard")}</Button></Link>
    </div>
  );
}
