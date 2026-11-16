"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/env";
import { clearDemoSession, demoLogin, readDemoSession } from "@/lib/demo-auth";
import type { Profile, Role } from "@/lib/types";

interface SessionUser {
  id: string;
  email: string | null;
}

interface UserContextValue {
  mode: "demo" | "live";
  user: SessionUser | null;
  profile: Profile | null;
  role: Role | null;
  loading: boolean;
  isAuthed: boolean;
  /** admin or supervisor */
  canManage: boolean;
  signIn: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

function demoProfile(name: string): Profile {
  const now = new Date().toISOString();
  return { id: "demo-admin", email: "demo@local", full_name: name, role: "admin", created_at: now, updated_at: now };
}

export function UserProvider({ children }: { children: ReactNode }) {
  const mode: "demo" | "live" = hasSupabaseEnv() ? "live" : "demo";
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!hasSupabaseEnv()) {
      const s = readDemoSession();
      setUser(s ? { id: "demo-admin", email: null } : null);
      setProfile(s ? demoProfile(s.name) : null);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    setUser({ id: u.id, email: u.email ?? null });
    const { data: p } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
    const now = new Date().toISOString();
    setProfile(
      (p as Profile | null) ?? { id: u.id, email: u.email ?? "", full_name: u.email ?? "", role: "team_member", created_at: now, updated_at: now }
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (!hasSupabaseEnv()) return;
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      // defer: calling supabase from inside this callback can deadlock the auth lock
      setTimeout(() => { load(); }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const signIn = useCallback<UserContextValue["signIn"]>(
    async (identifier, password) => {
      if (!hasSupabaseEnv()) {
        if (!demoLogin(identifier, password)) return { ok: false, error: "invalid_credentials" };
        await load();
        return { ok: true };
      }
      const { error } = await createClient().auth.signInWithPassword({ email: identifier.trim(), password });
      if (error) return { ok: false, error: "invalid_credentials" };
      await load();
      return { ok: true };
    },
    [load]
  );

  const signOut = useCallback(async () => {
    if (hasSupabaseEnv()) await createClient().auth.signOut();
    else clearDemoSession();
    setUser(null);
    setProfile(null);
    window.location.assign("/login");
  }, []);

  const value = useMemo<UserContextValue>(() => {
    const role = profile?.role ?? null;
    return {
      mode,
      user,
      profile,
      role,
      loading,
      isAuthed: !!user,
      canManage: role === "admin" || role === "supervisor",
      signIn,
      signOut,
    };
  }, [mode, user, profile, loading, signIn, signOut]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
