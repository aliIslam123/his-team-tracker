"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { FullPageSpinner } from "@/components/shared";

/** Protects every page under (app). Unauthenticated visitors are sent to /login and returned afterwards. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, isAuthed } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !isAuthed) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, isAuthed, pathname, router]);

  if (loading || !isAuthed) return <FullPageSpinner />;
  return <>{children}</>;
}
