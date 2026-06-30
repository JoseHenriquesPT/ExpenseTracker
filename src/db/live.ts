import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// A tiny reactive layer that replaces dexie-react-hooks' useLiveQuery.
//
// A module-level version counter bumps on (a) any Postgres change broadcast by
// Supabase realtime — so the *other* person's edits show up live — and (b) every
// local mutation via db.ts's touch(), so your own edits reflect immediately even
// if the realtime socket is momentarily behind. Every useLiveQuery re-runs when
// the version changes. Fine for a two-person app with small tables.

let version = 0;
const listeners = new Set<() => void>();

/** Bump the version and notify all live queries to refetch. */
export function touch(): void {
  version++;
  for (const l of listeners) l();
}

// One realtime channel for all public-schema changes.
supabase
  .channel("db-changes")
  .on("postgres_changes", { event: "*", schema: "public" }, () => touch())
  .subscribe();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): number {
  return version;
}

/**
 * Drop-in for dexie's useLiveQuery: runs an async query, returns `undefined`
 * until the first result, and refetches whenever the data version or a dep
 * changes.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  deps: unknown[] = []
): T | undefined {
  const v = useSyncExternalStore(subscribe, getSnapshot);
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    query()
      .then((r) => {
        if (alive) setValue(r);
      })
      .catch((e) => console.error("useLiveQuery:", e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps]);

  return value;
}
