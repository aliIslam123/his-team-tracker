import { NextRequest, NextResponse } from "next/server";
import { ApiError, isManageableRole, requireUserManager, serviceClient, toErrorResponse } from "@/lib/server/admin";
import type { Profile, UpdateUserInput } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/[id] — edit an engineer account (admin only).
 * Never accepts password fields here: passwords are set once at creation and
 * changed by the user afterwards (or reset through /password).
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireUserManager();
    const svc = serviceClient();
    const { id } = await ctx.params;
    const patch = (await request.json()) as UpdateUserInput;

    const { data: target, error: tErr } = await svc.from("profiles").select("*").eq("id", id).maybeSingle();
    if (tErr || !target) throw new ApiError(404, "user_not_found");
    const t = target as Profile;

    if (caller.role === "hospital_admin" && caller.hospital_id !== t.hospital_id) throw new ApiError(403, "not_allowed");
    if (t.role === "super_admin" && caller.role !== "super_admin") throw new ApiError(403, "not_allowed");

    const row: Record<string, unknown> = {};
    if (patch.full_name !== undefined) {
      const name = String(patch.full_name).trim();
      if (name.length < 3) throw new ApiError(400, "invalid_name");
      row.full_name = name;
    }
    if (patch.job_title !== undefined) row.job_title = patch.job_title?.trim() || null;
    if (patch.is_active !== undefined) row.is_active = Boolean(patch.is_active);
    if (patch.role !== undefined) {
      if (!isManageableRole(patch.role)) throw new ApiError(400, "invalid_role");
      if (caller.role === "hospital_admin" && (patch.role === "super_admin" || patch.role === "hospital_admin")) {
        throw new ApiError(403, "not_allowed");
      }
      row.role = patch.role;
    }
    if (patch.hospital_id !== undefined && patch.hospital_id !== t.hospital_id) {
      if (caller.role !== "super_admin") throw new ApiError(403, "not_allowed");
      const { data: hospital } = await svc.from("hospitals").select("id,is_active").eq("id", patch.hospital_id).maybeSingle();
      if (!hospital || !(hospital as { is_active: boolean }).is_active) throw new ApiError(400, "invalid_hospital");
      row.hospital_id = patch.hospital_id;
    }

    const { error: uErr } = await svc.from("profiles").update(row).eq("id", id);
    if (uErr) throw new ApiError(400, "error");

    // deactivation also revokes the Supabase session/ban so the account cannot sign in
    if (row.is_active !== undefined) {
      await svc.auth.admin.updateUserById(id, {
        ban_duration: row.is_active ? "none" : "876000h",
      });
    }

    await svc.from("audit_logs").insert({
      actor_id: caller.id,
      hospital_id: t.hospital_id,
      action: "user_updated",
      entity_type: "profile",
      entity_id: id,
      new_values: row,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
