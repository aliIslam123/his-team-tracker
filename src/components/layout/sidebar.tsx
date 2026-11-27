"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, ClipboardList, CalendarClock, BedDouble, AlertTriangle, BarChart3, Bell, Upload, ScrollText, Settings, LogOut, Building2, UserCog, GitCompareArrows, ListTodo, FileText,
} from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";
import { useUser } from "@/components/providers/user-provider";
import { can, type PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: PermissionKey;
  memberOnly?: boolean;
  section: "daily" | "insights" | "admin" | "system";
}

const NAV: NavItem[] = [
  { href: "/my-tasks", key: "my_tasks", icon: ListTodo, memberOnly: true, section: "daily" },
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, permission: "analytics.view", section: "daily" },
  { href: "/staff", key: "staff_directory", icon: Users, section: "daily" },
  { href: "/history", key: "history", icon: ClipboardList, section: "daily" },
  { href: "/followups", key: "followups", icon: CalendarClock, section: "daily" },
  { href: "/beds", key: "beds", icon: BedDouble, section: "daily" },
  { href: "/escalations", key: "escalations", icon: AlertTriangle, permission: "escalations.review", section: "insights" },
  { href: "/analytics", key: "analytics", icon: BarChart3, permission: "analytics.view", section: "insights" },
  { href: "/notifications", key: "notifications", icon: Bell, section: "insights" },
  { href: "/import", key: "import_staff", icon: Upload, permission: "staff.import", section: "admin" },
  { href: "/activity", key: "activity_logs", icon: ScrollText, permission: "activity.view", section: "admin" },
  { href: "/admin/hospitals", key: "hospitals", icon: Building2, permission: "hospitals.manage", section: "admin" },
  { href: "/admin/users", key: "users", icon: UserCog, permission: "users.manage", section: "admin" },
  { href: "/admin/comparison", key: "comparison", icon: GitCompareArrows, permission: "comparison.view", section: "admin" },
  { href: "/settings", key: "settings", icon: Settings, section: "system" },
];

const SECTIONS: { id: NavItem["section"]; label: string }[] = [
  { id: "daily", label: "nav_section_daily" },
  { id: "insights", label: "nav_section_insights" },
  { id: "admin", label: "nav_section_admin" },
  { id: "system", label: "nav_section_system" },
];

/** "Ali Abuelsoud" -> "AA" for the little avatar in the user card. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

/** The nav list itself — rendered inside the desktop sidebar and the mobile drawer. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { role, permissions, profile, hospital, signOut, formHref } = useUser();
  const items = NAV.filter(
    (i) => (!i.memberOnly || role === "member") && (!i.permission || can(role, i.permission, permissions))
  );

  return (
    <div className="flex h-full flex-col">
      <Link
        href={role === "member" ? "/my-tasks" : "/dashboard"}
        onClick={onNavigate}
        className="flex h-16 items-center border-b border-border/70 px-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Holool His" className="h-9 w-auto max-w-[170px] object-contain" />
      </Link>

      {profile && (
        <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl bg-muted/60 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(profile.full_name) || "—"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{profile.full_name}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {role ? t(`role_${role}`) : "—"}
              {hospital ? ` · ${hospital.name}` : ""}
            </p>
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {SECTIONS.map((section) => {
          const group = items.filter((i) => i.section === section.id);
          if (group.length === 0) return null;
          return (
            <div key={section.id} className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75">
                {t(section.label)}
              </p>
              {group.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    {active && <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                    <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                    <span className="truncate">{t(item.key)}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border/70 p-3">
        {formHref && (
          <Link
            href={formHref}
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <FileText className="h-4 w-4" />
            {t("evaluation_form")}
          </Link>
        )}
        <button
          type="button"
          onClick={() => { onNavigate?.(); signOut(); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-e border-border/70 bg-card md:block no-print">
      <SidebarContent />
    </aside>
  );
}
