import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { onHouseholdChange } from "./household";
import { pushToast } from "../lib/toast";

// A tiny reactive layer powering every page's live data.
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

// ---------------------------------------------------------------------------
// Realtime channel — opened once the session AND the household are known.
//
// RLS-protected postgres_changes bind the user's JWT at subscribe time, so a
// channel created before the session is restored would never receive the other
// person's edits. The householdId filter stops other tenants' changes from
// waking every query; migration 0012 sets replica identity full so DELETE
// events (which otherwise carry only the primary key) pass that filter too.
// ---------------------------------------------------------------------------

let session: Session | null = null;
let householdId: number | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let channelHouseholdId: number | null = null;

function stopLiveSync(): void {
  channelHouseholdId = null;
  if (!channel) return;
  supabase.removeChannel(channel);
  channel = null;
}

function syncLiveSync(): void {
  if (!session || householdId == null) {
    stopLiveSync();
    return;
  }
  if (channel && channelHouseholdId === householdId) return;
  stopLiveSync();
  channelHouseholdId = householdId;
  channel = supabase
    .channel("db-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", filter: `householdId=eq.${householdId}` },
      () => touch()
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Realtime channel unavailable:", status);
      }
    });
}

supabase.auth.onAuthStateChange((_event, s) => {
  session = s;
  syncLiveSync();
});

// Covers a session restored before this module loaded (e.g. a hot reload):
// onAuthStateChange won't replay that event for a fresh listener.
supabase.auth.getSession().then(({ data }) => {
  session = data.session;
  syncLiveSync();
});

// AuthGate resolves the household after sign-in; a change re-targets the
// filter, and clearing it on sign-out closes the channel.
onHouseholdChange((id) => {
  householdId = id;
  syncLiveSync();
});

// ---------------------------------------------------------------------------
// Live queries
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): number {
  return version;
}

let lastError = "";
let lastErrorAt = 0;

/** Surface a failed query without flooding the toaster on every retry. */
function reportQueryError(e: unknown): void {
  console.error("useLiveQuery:", e);
  const message = e instanceof Error ? e.message : String(e);
  const now = Date.now();
  if (message !== lastError || now - lastErrorAt > 10_000) {
    lastError = message;
    lastErrorAt = now;
    pushToast(`Couldn't load data — ${message}`, "error");
  }
}

/**
 * Runs an async query, returns `undefined` until the first result, and
 * refetches whenever the data version or a dep
 * changes. Changing a dep clears the previous result immediately so a page
 * can't briefly show another table's rows; a version bump keeps the current
 * value to avoid flicker.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  deps: unknown[] = []
): T | undefined {
  const v = useSyncExternalStore(subscribe, getSnapshot);
  const [value, setValue] = useState<T | undefined>(undefined);
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    setValue(undefined);
  }, [depsKey]);

  useEffect(() => {
    let alive = true;
    query()
      .then((r) => {
        if (alive) setValue(r);
      })
      .catch((e) => {
        if (alive) reportQueryError(e);
      });
    return () => {
      alive = false;
    };
    // Intentionally keyed on the version + serialized deps, not `query`
    // (a fresh closure every render would refetch in a loop).
  }, [v, depsKey]);

  return value;
}
