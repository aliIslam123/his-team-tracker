"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, SidebarContent } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useUser } from "@/components/providers/user-provider";
import { useLanguage } from "@/components/providers/language-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  const { mode } = useUser();
  const { t } = useLanguage();

  // Close the drawer during render when the route changes (React's "adjust state
  // when props change" pattern) instead of in an effect, which would cause a
  // synchronous cascading render.
  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden no-print" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-64 max-w-[85vw] bg-card shadow-xl">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        {mode === "demo" && (
          <div className="border-b bg-warning/10 px-4 py-1.5 text-center text-xs text-warning no-print">{t("demo_banner")}</div>
        )}
        <main className="flex-1 p-3 sm:p-4 md:p-6">{children}</main>
        <footer className="border-t py-3 text-center text-xs text-muted-foreground no-print">
          created by Ali Abuelsoud and Ismail Ali
        </footer>
      </div>
    </div>
  );
}
