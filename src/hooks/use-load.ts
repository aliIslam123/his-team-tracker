"use client";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/components/providers/user-provider";

/**
 * Small data-loading helper shared by the pages:
 * runs `fn` on mount (and whenever `deps` change or `reload()` is called) and tracks loading / error state.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  // super_admin hospital switch: refetch every scoped list when the scope changes.
  const { scope } = useUser();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // Run in an async callback: a synchronous setState in the effect body would
    // trigger a cascading render on every mount / dependency change.
    void (async () => {
      setLoading(true);
      try {
        const d = await fn();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled, scope]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload, setData };
}
