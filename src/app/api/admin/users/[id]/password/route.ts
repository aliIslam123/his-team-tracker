import { NextRequest, NextResponse } from "next/server";
import { ApiError, generatePassword, requireUserManager, serviceClient, toErrorResponse } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/[id]/password — reset an account password (admin only).
 * A new strong password is generated server-side, returned ONCE, and the account is
 * flagged must_change_password so the engineer changes it at the next sign-in.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireUserManager(request);
    // Supervisors may create member accounts only — never reset passwords.
    if (caller.role === "supervisor") throw new ApiError(403, "not_allowed");
    const svc = serviceClient();
    const { id } = await ctx.params;

    const { data: target, error: tErr } = await svc.from("profiles").select("*").eq("id", id).maybeSingle();
    if (tErr || !target) throw new ApiError(404, "user_not_found");
    const t = target as { hospital_id: string | null; role: string };

    if (caller.role === "hospital_admin" && caller.hospital_id !== t.hospital_id) throw new ApiError(403, "not_allowed");
    if (t.role === "super_admin" && caller.role !== "super_admin") throw new ApiError(403, "not_allowed");

    const password = generatePassword();
    const { error: uErr } = await svc.auth.admin.updateUserById(id, { password });
    if (uErr) throw new ApiError(400, "error");

    await svc.from("profiles").update({ must_change_password: true }).eq("id", id);

    await svc.from("audit_logs").insert({
      actor_id: caller.id,
      hospital_id: t.hospital_id,
      action: "password_reset",
      entity_type: "profile",
      entity_id: id,
      new_values: { reset: true }, // never the password itself
    });

    return NextResponse.json({ password });
  } catch (err) {
    return toErrorResponse(err);
  }
}
