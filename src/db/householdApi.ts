import { supabase } from "./supabase";
import { touch } from "./live";
import {
  getHouseholdSnapshot, setHousehold,
  type Household, type HouseholdKind,
} from "./household";
import { toMessage } from "../lib/errors";
import i18n from "../i18n";

// The household API: the RPCs from migration 0013 plus invite management,
// wrapped with the module-state refresh every caller needs. AuthGate uses
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

/** Run a household RPC, refresh the module state and wake live queries. */
async function runHouseholdRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(toMessage(error));
  await refreshHousehold();
  touch();
}

/** "Just me" (single) or "me and a partner" (couple). Fails if the account
 *  already belongs to a household. */
export async function createHousehold(kind: HouseholdKind): Promise<void> {
  await runHouseholdRpc("create_household", { p_kind: kind });
}

/** Join a couple household with an invite code. */
export async function joinHousehold(code: string): Promise<void> {
  await runHouseholdRpc("join_household", { p_code: code });
}

/** Enter a partner's code from Settings while already in your own household:
 *  the server moves your rows into their household (retagged P1 -> P2), then
 *  removes your old household. Only works when you're alone in yours. */
export async function mergeIntoHousehold(code: string): Promise<void> {
  await runHouseholdRpc("merge_into_household", { p_code: code });
}

/** Break up the household. Every member keeps a copy of the past months' data
 *  in their own new single-person household; the current month is deleted. */
export async function dismantleHousehold(): Promise<void> {
  await runHouseholdRpc("dismantle_household", {});
}

/** Owner-only: turn a single household into a couple one (so it can invite). */
export async function upgradeToCouple(): Promise<void> {
  await runHouseholdRpc("set_household_kind", { p_kind: "couple" });
}

/** An active invite code for the current household. */
export interface HouseholdInvite {
  id: number;
  code: string;
}

/** Create a fresh invite for the current household. The code is generated
 *  server-side by the create_invite() SECURITY DEFINER RPC (migration 0017) —
 *  clients can't choose or tamper with codes. */
export async function createInvite(): Promise<HouseholdInvite> {
  const household = getHouseholdSnapshot();
  if (!household) throw new Error(i18n.t("errors.householdNotLoaded"));
  const { data, error } = await supabase.rpc("create_invite");
  if (error) throw new Error(toMessage(error));
  touch();
  return data as unknown as HouseholdInvite;
}

export async function revokeInvite(id: number): Promise<void> {
  const { error } = await supabase.from("household_invites").delete().eq("id", id);
  if (error) throw new Error(toMessage(error));
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
