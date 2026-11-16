"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/providers/language-provider";

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="text-muted-foreground">{t("not_found")}</p>
      <Link href="/"><Button>{t("back_home")}</Button></Link>
    </div>
  );
}
