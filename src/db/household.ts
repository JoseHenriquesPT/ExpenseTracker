// The signed-in user's household, resolved once per session by AuthGate via the
// `current_household()` RPC (migration 0013). The data layer (db.ts) and the
// realtime channel (live.ts) read it so every query, write and subscription is
// scoped to one household. Module-level state on purpose: it sits below the
// React tree, next to the data layer it feeds.

/** single = one person, everything centres on them; couple = the P1/P2 model. */
export type HouseholdKind = "single" | "couple";

export interface Household {
  id: number;
  name: string;
  kind: HouseholdKind;
  /** Members, including the owner — used to gate invite UI. */
  memberCount: number;
}

let current: Household | null = null;
const listeners = new Set<() => void>();

/** Set (or clear, with null) the active household and notify subscribers. */
export function setHousehold(household: Household | null): void {
  if (household === current) return;
  current = household;
  for (const l of listeners) l();
}

/** The active household. Throws if the app is rendered before AuthGate has
 *  resolved it — a bug, not a state a user should ever hit. */
export function getHousehold(): Household {
  if (current == null) {
    throw new Error("Household not loaded yet — sign-in must resolve it first.");
  }
  return current;
}

/** Shorthand for {@link getHousehold}().id, the scoping key of every query. */
export function getHouseholdId(): number {
  return getHousehold().id;
}

/** Current value for `useSyncExternalStore` subscribers. */
export function getHouseholdSnapshot(): Household | null {
  return current;
}

/** Subscribe to household changes. Returns an unsubscribe function. */
export function onHouseholdChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
