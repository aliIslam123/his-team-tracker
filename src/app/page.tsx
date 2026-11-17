"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/user-provider";
import { FullPageSpinner } from "@/components/shared";

/** The old public form now lives at /h/<hospital-slug>; "/" just routes signed-in users in. */
export default function HomePage() {
  const { loading, isAuthed } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(isAuthed ? "/dashboard" : "/login");
  }, [loading, isAuthed, router]);

  return <FullPageSpinner />;
}
