"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { FullPageSpinner } from "@/components/shared";

/** The old public form now lives at /h/<hospital-slug>; "/" just routes signed-in users in. */
export default function HomePage() {
  const { loading, isAuthed, role } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(!isAuthed ? "/login" : role === "member" ? "/my-tasks" : "/dashboard");
  }, [loading, isAuthed, role, router]);

  return <FullPageSpinner />;
}
