"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { FullPageSpinner } from "@/components/shared";

/**
 * Protects every page under (app): unauthenticated visitors are sent to /login,
 * and an engineer with a forced password change (must_change_password) is sent
 * to /change-password before anything else.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading, isAuthed, mustChangePassword } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !isAuthed) return;
    if (mustChangePassword && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [loading, isAuthed, mustChangePassword, pathname, router]);

  useEffect(() => {
    if (!loading && !isAuthed) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, isAuthed, pathname, router]);

  if (loading || !isAuthed) return <FullPageSpinner />;
  if (mustChangePassword) return <FullPageSpinner />;
  return <>{children}</>;
}
