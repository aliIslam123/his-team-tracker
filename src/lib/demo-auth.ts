/**
 * Demo-mode session key + seeded credentials (only used when Supabase env vars are NOT set).
 * The accounts themselves live in the demo repo (localStorage, key his_demo_db_v2);
 * this file only owns the session cookie-equivalent and the legacy seed credentials.
 */
export const DEMO_SESSION_KEY = "his_demo_session";

export const DEMO_USER = process.env.NEXT_PUBLIC_DEMO_USER || "teamhis";
export const DEMO_PASS = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "adminhis@@@";

export interface DemoSession {
  username: string;
  name: string;
}

export function readDemoSession(): DemoSession | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    return raw ? (JSON.parse(raw) as DemoSession) : null;
  } catch {
    return null;
  }
}

export function clearDemoSession() {
  try { localStorage.removeItem(DEMO_SESSION_KEY); } catch {}
}
