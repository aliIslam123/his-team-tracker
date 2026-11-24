import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Admin account management (المهندسون) runs on the SERVER only:
 * the service-role key is a plain environment variable (no NEXT_PUBLIC_ prefix),
 * so it is never included in any client bundle.
 * This module must only be imported from Route Handlers / Server code.
 */

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

let cachedService: SupabaseClient | null = null;

/** Supabase client with the service-role key. Throws when the key is not configured. */
export function serviceClient(): SupabaseClient {
  if (cachedService) return cachedService;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(500, "service_not_configured");
  cachedService = createSupabaseJsClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedService;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Uniform error mapping for the admin Route Handlers. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) return NextResponse.json({ error: err.code }, { status: err.status });
  return NextResponse.json({ error: "error" }, { status: 500 });
}

/** Verifies the signed-in caller is allowed to manage accounts.
 *  supervisor is admitted for CREATE ONLY (member accounts in their own hospital);
 *  the route handlers enforce that restriction. */
/** Defense in depth against cross-site requests: when the browser sends an Origin header it must match our host. */
function assertSameOrigin(request?: Request) {
  const origin = request?.headers.get("origin");
  if (!origin) return;
  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  let originHost = "";
  try { originHost = new URL(origin).host; } catch { /* malformed */ }
  if (!host || originHost !== host) throw new ApiError(403, "bad_origin");
}

export async function requireUserManager(request?: Request): Promise<Profile> {
  assertSameOrigin(request);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError(401, "not_authenticated");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  const p = profile as Profile | null;
  if (!p) throw new ApiError(401, "not_authenticated");
  if (p.role !== "super_admin" && p.role !== "hospital_admin" && p.role !== "supervisor") throw new ApiError(403, "not_allowed");
  return p;
}

export function assertUsername(raw: unknown): string {
  const username = String(raw ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new ApiError(400, "invalid_username");
  return username;
}

export const internalEmail = (username: string) => `${username}@his.local`;

/**
 * A strong random password generated on the server with a CSPRNG.
 * It is returned to the admin exactly once (Supabase stores only a hash),
 * then it can be reset but never displayed again.
 */
export function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
  const all = sets.join("");
  // randomInt is unbiased (no modulo bias) and CSPRNG-backed.
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const out = sets.map(pick);
  while (out.length < 16) out.push(pick(all));
  // Fisher–Yates shuffle with unbiased indices
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

export function isManageableRole(role: string): boolean {
  return role === "super_admin" || role === "hospital_admin" || role === "supervisor" || role === "member";
}
