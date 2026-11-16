"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, ClipboardList, CalendarClock, AlertTriangle, BarChart3, Bell, Upload, ScrollText, Settings, LogOut,
} from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/staff", key: "staff_directory", icon: Users },
  { href: "/history", key: "history", icon: ClipboardList },
  { href: "/followups", key: "followups", icon: CalendarClock },
  { href: "/escalations", key: "escalations", icon: AlertTriangle },
  { href: "/analytics", key: "analytics", icon: BarChart3 },
  { href: "/notifications", key: "notifications", icon: Bell },
  { href: "/import", key: "import_staff", icon: Upload, roles: ["admin", "supervisor"] },
  { href: "/activity", key: "activity_logs", icon: ScrollText, roles: ["admin", "supervisor"] },
  { href: "/settings", key: "settings", icon: Settings },
];

/** The nav list itself — rendered inside the desktop sidebar and the mobile drawer. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { role, signOut } = useUser();
  const items = NAV.filter((i) => !i.roles || (role && i.roles.includes(role)));

  return (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-3 border-b p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-contain" />
        <span className="font-semibold leading-tight">{t("app_name")}</span>
      </Link>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t p-2">
        <Link href="/" onClick={onNavigate} className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          {t("evaluation_form")}
        </Link>
        <button
          type="button"
          onClick={() => { onNavigate?.(); signOut(); }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t("logout")}
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e bg-card md:block no-print">
      <SidebarContent />
    </aside>
  );
}
