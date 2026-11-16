/**
 * Maps errors thrown by the data layer to a translation key.
 * Server-side functions raise short codes (invalid_phone, staff_not_found, ...).
 */
const KNOWN = [
  "invalid_phone",
  "invalid_reporter_name",
  "invalid_result",
  "invalid_name",
  "invalid_job_type",
  "staff_not_found",
  "duplicate_his_id",
  "not_allowed",
] as const;

export function errorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : (err as { message?: string })?.message ?? "";
  const hit = KNOWN.find((k) => msg.includes(k));
  return hit ? `err_${hit}` : "error";
}
