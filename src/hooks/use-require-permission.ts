"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { can, type PermissionKey } from "@/lib/permissions";

/**
 * Redirects to /access-denied when the signed-in user lacks the permission.
 * Returns true only once the role is known AND allowed, so pages can skip data loading until then.
 */
export function useRequirePermission(permission: PermissionKey): boolean {
  const { role, permissions, loading, isAuthed } = useUser();
  const router = useRouter();
  const ok = can(role, permission, permissions);
  useEffect(() => {
    if (!loading && isAuthed && !ok) router.replace("/access-denied");
  }, [loading, isAuthed, ok, router]);
  return ok;
}
