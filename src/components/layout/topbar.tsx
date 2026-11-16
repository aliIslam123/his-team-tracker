"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon, Languages, Menu, Bell } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getRepo } from "@/lib/repo";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { lang, setLang, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { profile, role, signOut } = useUser();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // unread badge: refresh on navigation and once a minute
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const list = await getRepo().listNotifications();
        if (alive) setUnread(list.filter((n) => !n.is_read).length);
      } catch {}
    };
    run();
    const timer = setInterval(run, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur no-print">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick} aria-label={t("menu")}>
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex-1" />
      <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t("theme")}>
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Languages className="h-4 w-4" />
            {lang === "ar" ? "العربية" : "English"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setLang("ar")}>العربية</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLang("en")}>English</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Link href="/notifications" aria-label={t("notifications")} className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="max-w-40 truncate">{profile?.full_name ?? "—"}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{profile?.email || profile?.full_name}{role ? ` · ${t(`role_${role}`)}` : ""}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut()}>{t("logout")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
