import type { Role } from "@/lib/types";

/**
 * THE permission list — the single source of truth for what each role may do.
 *
 * Every capability the app checks (sidebar, page guards, action buttons) resolves through
 * can(), and the database enforces the same keys in supabase/migrations/0006_permissions.sql
 * (public.has_permission). Keep the two lists identical:
 *
 *   staff.manage        create / edit / deactivate / delete staff members
 *   staff.import        bulk import staff from a sheet
 *   staff.assign        assign staff members to member accounts
 *   users.manage        the /admin/users screen (create accounts, roles, resets)
 *   hospitals.manage    the /admin/hospitals screen (super_admin only — forced)
 *   activity.view       the /activity audit log screen
 *   escalations.review  review / approve / reject escalation drafts
 *   followups.manage    change follow-up statuses (members may still do their own)
 *   analytics.view      dashboard & analytics pages
 *   comparison.view     the cross-hospital comparison dashboard (super_admin only — forced)
 *   beds.manage         add / delete beds, edit owner / location / number, import beds
 *   beds.assigned       edit the beds assigned to him (boxes, dates, patient name, notes)
 *
 * profiles.permissions (jsonb) holds per-user overrides: {"staff.import": false} removes an
 * ability the role would otherwise have, {"analytics.view": true} adds one. Users can never
 * change their own overrides (DB trigger + service-role-only API).
 */
export const PERMISSION_KEYS = [
  "staff.manage",
  "staff.import",
  "staff.assign",
  "users.manage",
  "hospitals.manage",
  "activity.view",
  "escalations.review",
  "followups.manage",
  "analytics.view",
  "comparison.view",
  "beds.manage",
  "beds.assigned",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** These keys are always super_admin-only — a JSON override can never grant them to a lower role. */
export const SUPER_ONLY_PERMISSIONS: PermissionKey[] = ["hospitals.manage", "comparison.view"];

/** What each role gets when profiles.permissions does not override it. Mirrors 0006 SQL. */
export const ROLE_PERMISSION_DEFAULTS: Record<Role, PermissionKey[]> = {
  super_admin: [...PERMISSION_KEYS],
  hospital_admin: [
    "staff.manage",
    "staff.import",
    "staff.assign",
    "users.manage",
    "activity.view",
    "escalations.review",
    "followups.manage",
    "analytics.view",
    "beds.manage",
  ],
  supervisor: [
    "staff.manage",
    "staff.import",
    "activity.view",
    "escalations.review",
    "followups.manage",
    "analytics.view",
    "beds.manage",
  ],
  member: ["analytics.view", "beds.assigned"],
};

/** Human-readable labels for the admin screens (TranslationKey-compatible keys). */
export const PERMISSION_LABEL_KEY: Record<PermissionKey, string> = {
  "staff.manage": "perm_staff_manage",
  "staff.import": "perm_staff_import",
  "staff.assign": "perm_staff_assign",
  "users.manage": "perm_users_manage",
  "hospitals.manage": "perm_hospitals_manage",
  "activity.view": "perm_activity_view",
  "escalations.review": "perm_escalations_review",
  "followups.manage": "perm_followups_manage",
  "analytics.view": "perm_analytics_view",
  "comparison.view": "perm_comparison_view",
  "beds.manage": "perm_beds_manage",
  "beds.assigned": "perm_beds_assigned",
};

/**
 * Can this role (+ optional per-user overrides) perform this action?
 *  - unknown / missing role → false;
 *  - explicit false in overrides wins over the role default;
 *  - SUPER_ONLY_PERMISSIONS ignore overrides (and require super_admin);
 *  - super_admin always true.
 */
export function can(
  role: Role | null | undefined,
  permission: PermissionKey,
  overrides?: Record<string, boolean> | null
): boolean {
  if (!role) return false;
  if (SUPER_ONLY_PERMISSIONS.includes(permission)) return role === "super_admin";
  const override = overrides?.[permission];
  if (typeof override === "boolean") return override;
  return ROLE_PERMISSION_DEFAULTS[role].includes(permission);
}

/** Convenience for components: every permission the profile currently has (for lists/badges). */
export function permissionsOf(
  role: Role | null | undefined,
  overrides?: Record<string, boolean> | null
): PermissionKey[] {
  if (!role) return [];
  return PERMISSION_KEYS.filter((k) => can(role, k, overrides));
}
