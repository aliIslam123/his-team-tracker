export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Demo mode keeps all data in the visitor's browser and uses a login that is visible in the
 * client bundle, so it must NEVER be what a production deployment falls back to by accident
 * (e.g. a missing environment variable on the host). In production it is refused unless the
 * deployer explicitly opts in with NEXT_PUBLIC_ALLOW_DEMO=true (for a public demo site).
 */
export function isDemoBlocked() {
  return !hasSupabaseEnv() && process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ALLOW_DEMO !== "true";
}
