import { NextRequest, NextResponse } from "next/server";
import { ApiError, assertUsername, generatePassword, internalEmail, isManageableRole, requireUserManager, serviceClient, toErrorResponse } from "@/lib/server/admin";
import type { CreateUserInput, UserAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

const toAccount = (p: Record<string, unknown>): UserAccount => ({
  id: String(p.id),
  username: (p.username as string) ?? null,
  email: (p.email as string) ?? null,
  full_name: (p.full_name as string) ?? "",
  job_title: (p.job_title as string) ?? null,
  role: (p.role as UserAccount["role"]) ?? "member",
  hospital_id: (p.hospital_id as string) ?? null,
  permissions: (p.permissions as Record<string, boolean>) ?? {},
  must_change_password: Boolean(p.must_change_password),
  is_active: p.is_active !== false,
  created_at: (p.created_at as string) ?? new Date().toISOString(),
});

/**
 * POST /api/admin/users — create an engineer account (admin only).
 * The generated password is returned ONCE; Supabase keeps only its hash.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireUserManager();
    const svc = serviceClient();

    const body = (await request.json()) as Partial<CreateUserInput>;
    const username = assertUsername(body.username);
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "member");
    const hospitalId = String(body.hospital_id ?? "");

    if (fullName.length < 3) throw new ApiError(400, "invalid_name");
    if (!isManageableRole(role)) throw new ApiError(400, "invalid_role");

    // hospital scope + active check
    const { data: hospital, error: hErr } = await svc.from("hospitals").select("id,is_active").eq("id", hospitalId).maybeSingle();
    if (hErr || !hospital) throw new ApiError(400, "invalid_hospital");
    if (!(hospital as { is_active: boolean }).is_active) throw new ApiError(400, "invalid_hospital");
    if (caller.role === "hospital_admin" && caller.hospital_id !== hospitalId) throw new ApiError(403, "not_allowed");

    // hospital_admin may only hand out supervisor / member
    if (caller.role === "hospital_admin" && (role === "super_admin" || role === "hospital_admin")) {
      throw new ApiError(403, "not_allowed");
    }

    const password = generatePassword();
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email: internalEmail(username),
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
        role,
        hospital_id: hospitalId,
        must_change_password: Boolean(body.must_change_password),
      },
    });
    if (createErr) {
      if (String(createErr.message).toLowerCase().includes("already been registered")) throw new ApiError(409, "duplicate_username");
      throw new ApiError(400, "invalid_username");
    }
    const uid = created.user!.id;

    // the trigger created a default profile row; fill the admin-only fields
    const { data: profileRow, error: pErr } = await svc
      .from("profiles")
      .update({ job_title: body.job_title?.trim() || null })
      .eq("id", uid)
      .select("id, username, email, full_name, job_title, role, hospital_id, permissions, must_change_password, is_active, created_at")
      .single();
    if (pErr) throw new ApiError(500, "error");

    await svc.from("audit_logs").insert({
      actor_id: caller.id,
      hospital_id: hospitalId,
      action: "user_created",
      entity_type: "profile",
      entity_id: uid,
      new_values: { username, role, hospital_id: hospitalId }, // never the password
    });

    return NextResponse.json({ user: toAccount(profileRow as Record<string, unknown>), password }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
