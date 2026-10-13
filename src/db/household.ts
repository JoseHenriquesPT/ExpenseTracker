// The signed-in user's household id, resolved once per session by AuthGate via
// the `current_household_id()` RPC (migration 0009). The data layer (db.ts) and
// the realtime channel (live.ts) read it so every query, write and subscription
// is scoped to one household. Module-level state on purpose: it sits below the
// React tree, next to the data layer it feeds.

let current: number | null = null;
const listeners = new Set<(id: number | null) => void>();

/** Set (or clear, with null) the active household and notify subscribers. */
export function setHouseholdId(id: number | null): void {
  if (id === current) return;
  current = id;
  for (const l of listeners) l(id);
}

/** The active household id. Throws if the app is rendered before AuthGate has
 *  resolved it — a bug, not a state a user should ever hit. */
export function getHouseholdId(): number {
  if (current == null) {
    throw new Error("Household not loaded yet — sign-in must resolve it first.");
  }
  return current;
}

/** Subscribe to household changes. Returns an unsubscribe function. */
export function onHouseholdChange(listener: (id: number | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
