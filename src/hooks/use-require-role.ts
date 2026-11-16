"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import type { Role } from "@/lib/types";

/**
 * Redirects to /access-denied when the signed-in user's role is not allowed.
 * Returns true only once the role is known AND allowed, so pages can skip data loading until then.
 */
export function useRequireRole(allowed: Role[]): boolean {
  const { role, loading, isAuthed } = useUser();
  const router = useRouter();
  const ok = !!role && allowed.includes(role);
  useEffect(() => {
    if (!loading && isAuthed && !ok) router.replace("/access-denied");
  }, [loading, isAuthed, ok, router]);
  return ok;
}
