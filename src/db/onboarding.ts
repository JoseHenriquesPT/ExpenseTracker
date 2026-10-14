import { supabase } from "./supabase";
import { touch } from "./live";
import {
  getHouseholdSnapshot, setHousehold,
  type Household, type HouseholdKind,
} from "./household";

// Onboarding + household management API: the RPCs from migration 0013 wrapped
// with the module-state refresh every caller needs. AuthGate uses
// fetchHousehold() to decide between onboarding and the app; the Onboarding and
// Settings screens use the rest.

/** Raw row shape of the current_household() RPC. */
interface HouseholdRow {
  id: number;
  name: string;
  kind: string;
  memberCount: number;
}

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "single" ? "single" : "couple",
    memberCount: row.memberCount,
  };
}

/** Read the caller's household; null when the account doesn't have one yet. */
export async function fetchHousehold(): Promise<Household | null> {
  const { data, error } = await supabase.rpc("current_household");
  if (error) throw error;
  const rows = (data ?? []) as HouseholdRow[];
  return rows.length ? toHousehold(rows[0]) : null;
}

/** Refresh the module state from the server and return what it found. */
export async function refreshHousehold(): Promise<Household | null> {
  const household = await fetchHousehold();
  setHousehold(household);
  return household;
}

/** "Just me" (single) or "me and a partner" (couple). Fails if the account
 *  already belongs to a household. */
export async function createHousehold(kind: HouseholdKind): Promise<void> {
  const { error } = await supabase.rpc("create_household", { p_kind: kind });
  if (error) throw new Error(error.message);
  await refreshHousehold();
  touch();
}

/** Join a couple household with an invite code. */
export async function joinHousehold(code: string): Promise<void> {
  const { error } = await supabase.rpc("join_household", { p_code: code });
  if (error) throw new Error(error.message);
  await refreshHousehold();
  touch();
}

/** Owner-only: turn a single household into a couple one (so it can invite). */
export async function upgradeToCouple(): Promise<void> {
  const { error } = await supabase.rpc("set_household_kind", { p_kind: "couple" });
  if (error) throw new Error(error.message);
  await refreshHousehold();
  touch();
}

/** An active invite code for the current household. */
export interface HouseholdInvite {
  id: number;
  code: string;
}

/** Create a fresh invite for the current household (server generates the code). */
export async function createInvite(): Promise<HouseholdInvite> {
  const household = getHouseholdSnapshot();
  if (!household) throw new Error("Household not loaded yet — sign-in must resolve it first.");
  const { data, error } = await supabase
    .from("household_invites")
    .insert({ householdId: household.id })
    .select("id, code")
    .single();
  if (error) throw new Error(error.message);
  touch();
  return data as HouseholdInvite;
}

export async function revokeInvite(id: number): Promise<void> {
  const { error } = await supabase.from("household_invites").delete().eq("id", id);
  if (error) throw new Error(error.message);
  touch();
}

/** Unused, unexpired invites for the current household, oldest first. */
export async function listInvites(): Promise<HouseholdInvite[]> {
  const household = getHouseholdSnapshot();
  if (!household) return [];
  const { data, error } = await supabase
    .from("household_invites")
    .select("id, code")
    .eq("householdId", household.id)
    .is("usedAt", null)
    .gt("expiresAt", new Date().toISOString())
    .order("id");
  if (error) throw error;
  return (data ?? []) as HouseholdInvite[];
}
