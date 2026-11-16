/**
 * Demo-mode login (only used when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are NOT set).
 * Nothing is protected in demo mode — all data lives in this browser's localStorage —
 * so this only gates the admin screens for demos. With Supabase configured, real
 * Supabase Auth + RLS is used and this file is ignored.
 */
export const DEMO_SESSION_KEY = "his_demo_session";

const DEMO_USER = process.env.NEXT_PUBLIC_DEMO_USER || "teamhis";
const DEMO_PASS = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "adminhis@@@";

export interface DemoSession {
  username: string;
  name: string;
}

export function demoLogin(username: string, password: string): boolean {
  if (username.trim() !== DEMO_USER || password !== DEMO_PASS) return false;
  try {
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ username: DEMO_USER, name: "Demo Admin" } satisfies DemoSession));
  } catch {}
  return true;
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
