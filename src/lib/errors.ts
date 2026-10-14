// The one place thrown values become user-facing sentences, shared by the
// data layer (db.ts), the household API and the auth screens.

import i18n from "../i18n";

/** Server messages (Postgres `raise exception` text) mapped to translation
 *  keys, so database errors reach the user in their language. In English the
 *  key resolves back to the exact server string, keeping pass-through intact. */
const SERVER_MESSAGES = {
  "Sign in first.": "errors.rpc.signInFirst",
  "This account has no household yet.": "errors.rpc.noHouseholdYet",
  "That invite code is not valid.": "errors.rpc.inviteInvalid",
  "That invite has already been used.": "errors.rpc.inviteUsed",
  "That invite has expired.": "errors.rpc.inviteExpired",
  "Both accounts are already in the same household.": "errors.rpc.sameHousehold",
  "That household is for one person — ask them to upgrade it first.": "errors.rpc.singleHousehold",
  "That household is already full.": "errors.rpc.householdFull",
  "Your household has another member — dismantle it before joining another.": "errors.rpc.otherMember",
  "This account has no household.": "errors.rpc.noHousehold",
  "You are not a member of this household.": "errors.rpc.notMember",
  "This account has no household — nothing to import into.": "errors.rpc.noHouseholdImport",
  "This account already belongs to a household.": "errors.rpc.alreadyBelongs",
  "Only the household owner can change this.": "errors.rpc.ownerOnly",
  "Only upgrading a single household to a couple one is supported.": "errors.rpc.upgradeOnlySingle",
  "This household is already a couple household.": "errors.rpc.alreadyCouple",
} as const satisfies Record<string, string>;

/** Turn any thrown value into a short, user-facing sentence. Network failures
 *  get a friendly phrasing instead of the browser's "Failed to fetch", and
 *  known server messages are translated. */
export function toMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/failed to fetch|networkerror|load failed|fetch/i.test(msg)) {
    return i18n.t("errors.network");
  }
  const key = SERVER_MESSAGES[msg as keyof typeof SERVER_MESSAGES];
  if (key) return i18n.t(key);
  return msg;
}
