import { hasSupabaseEnv } from "@/lib/env";
import { demoRepo } from "@/lib/repo/demo";
import { liveRepo } from "@/lib/repo/live";
import type { Repo } from "@/lib/repo/types";

export type { Repo } from "@/lib/repo/types";

/** Returns the backend for the current environment. Call from client code only (effects / handlers). */
export function getRepo(): Repo {
  return hasSupabaseEnv() ? liveRepo : demoRepo;
}
