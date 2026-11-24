import { NextResponse } from "next/server";
import { hasSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Uptime probe for the host / a monitoring service (UptimeRobot, Better Stack, ...).
 * Returns no secrets and no data: only whether the app is up and which backend it is wired to.
 * When Supabase is configured it also checks that the database answers.
 */
export async function GET() {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ status: "ok", backend: "demo" });
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NextResponse.json({ status: "degraded", backend: "supabase" }, { status: 503 });
    return NextResponse.json({ status: "ok", backend: "supabase" });
  } catch {
    return NextResponse.json({ status: "degraded", backend: "supabase" }, { status: 503 });
  }
}
