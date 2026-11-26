"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/env";
import { clearDemoSession } from "@/lib/demo-auth";
import { demoUserLogin, readDemoSessionUser } from "@/lib/repo/demo";
import { getRepo } from "@/lib/repo";
import { can, type PermissionKey } from "@/lib/permissions";
import type { Hospital, Profile, Role } from "@/lib/types";

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
  /** The engineer's own hospital (null only for super_admin = all hospitals). */
  hospital: Hospital | null;
  /** Hospitals visible to this user (own hospital for everyone, all of them for super_admin). */
  hospitals: Hospital[];
  /** Link to this hospital's public evaluation form (/h/<slug>) — null when unknown. */
  formHref: string | null;
  isSuper: boolean;
  /** supervisor / hospital_admin / super_admin (respects per-user overrides). */
  canManage: boolean;
  /** Check any permission with this user's overrides applied. */
  canDo: (permission: PermissionKey) => boolean;
  /** Forced password change on first sign-in (or after an admin reset). */
  mustChangePassword: boolean;
  /** super_admin only: the hospital currently being viewed (null = all hospitals). */
  scope: string | null;
  setScope: (hospitalId: string | null) => void;
  permissions: Record<string, boolean>;
  signIn: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  /** Re-reads the profile row (e.g. after changing the password). */
  refreshProfile: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

const SCOPE_KEY = "his_hospital_scope";

function demoProfile(u: NonNullable<ReturnType<typeof readDemoSessionUser>>): Profile {
  const now = new Date().toISOString();
  return {
    id: u.id,
    email: `${u.username}@his.local`,
    full_name: u.full_name,
    role: u.role,
    username: u.username,
    hospital_id: u.hospital_id,
    must_change_password: u.must_change_password,
    is_active: u.is_active,
    permissions: u.permissions ?? null,
    created_at: u.created_at,
    updated_at: now,
  };
}

/** username → the internal login email Supabase Auth knows (username@his.local). */
function toInternalEmail(identifier: string): string {
  const clean = identifier.trim().toLowerCase();
  return clean.includes("@") ? clean : `${clean}@his.local`;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const mode: "demo" | "live" = hasSupabaseEnv() ? "live" : "demo";
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [scope, setScopeState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyProfile = useCallback(async (u: SessionUser, p: Profile) => {
    setUser(u);
    setProfile(p);
    // visible hospitals: exactly one for everyone, all of them for super_admin
    try {
      setHospitals(await getRepo().listHospitals());
    } catch {
      setHospitals([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!hasSupabaseEnv()) {
      const u = readDemoSessionUser();
      if (u) await applyProfile({ id: u.id, email: `${u.username}@his.local` }, demoProfile(u));
      else { setUser(null); setProfile(null); }
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) {
      setUser(null);
      setProfile(null);
      setHospitals([]);
      setLoading(false);
      return;
    }
    const { data: p } = await supabase.from("profiles").select("*").eq("id", u.id).maybeSingle();
    const now = new Date().toISOString();
    const profileRow = (p as Profile | null) ?? {
      id: u.id, email: u.email ?? "", full_name: u.email ?? "", role: "member" as Role, created_at: now, updated_at: now,
    };
    await applyProfile({ id: u.id, email: u.email ?? null }, profileRow);
    setLoading(false);
  }, [applyProfile]);

  useEffect(() => {
    let alive = true;
    // Defer to a microtask so no state is set synchronously in the effect body.
    void Promise.resolve().then(() => {
      if (!alive) return;
      void load();
      // restore the super_admin's hospital scope
      let savedScope: string | null = null;
      try {
        const raw = localStorage.getItem(SCOPE_KEY);
        savedScope = raw && raw !== "all" ? raw : null;
      } catch {}
      setScopeState(savedScope);
      getRepo().setHospitalScope(savedScope);
    });
    if (!hasSupabaseEnv()) return () => { alive = false; };
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      // defer: calling supabase from inside this callback can deadlock the auth lock
      setTimeout(() => { load(); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const signIn = useCallback<UserContextValue["signIn"]>(
    async (identifier, password) => {
      if (!hasSupabaseEnv()) {
        if (!demoUserLogin(identifier, password)) return { ok: false, error: "invalid_credentials" };
        await load();
        return { ok: true };
      }
      const { error } = await createClient().auth.signInWithPassword({
        email: toInternalEmail(identifier),
        password,
      });
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
    setHospitals([]);
    setScopeState(null);
    getRepo().setHospitalScope(null);
    try { localStorage.removeItem(SCOPE_KEY); } catch {}
    router.push("/login");
  }, [router]);

  const setScope = useCallback((hospitalId: string | null) => {
    setScopeState(hospitalId);
    getRepo().setHospitalScope(hospitalId);
    try {
      if (hospitalId) localStorage.setItem(SCOPE_KEY, hospitalId);
      else localStorage.removeItem(SCOPE_KEY);
    } catch {}
  }, []);

  const value = useMemo<UserContextValue>(() => {
    const role = profile?.role ?? null;
    // the public form of the hospital being viewed: the super_admin's scope, else the engineer's own hospital
    const target = scope ? hospitals.find((h) => h.id === scope) : hospitals.find((h) => h.id === profile?.hospital_id);
    return {
      mode,
      user,
      profile,
      role,
      loading,
      isAuthed: !!user,
      hospital: hospitals.find((h) => h.id === profile?.hospital_id) ?? null,
      hospitals,
      formHref: target?.is_active ? `/h/${target.slug}` : null,
      isSuper: role === "super_admin",
      canManage: can(role, "staff.manage", profile?.permissions),
      canDo: (permission: PermissionKey) => can(role, permission, profile?.permissions),
      mustChangePassword: profile?.must_change_password === true,
      scope,
      setScope,
      permissions: profile?.permissions ?? {},
      signIn,
      signOut,
      refreshProfile: load,
    };
  }, [mode, user, profile, hospitals, scope, setScope, loading, signIn, signOut, load]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
