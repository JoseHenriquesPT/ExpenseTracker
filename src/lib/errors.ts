// The one place thrown values become user-facing sentences, shared by the
// data layer (db.ts), the household API and the auth screens.

/** Turn any thrown value into a short, user-facing sentence. Network failures
 *  get a friendly phrasing instead of the browser's "Failed to fetch". */
export function toMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/failed to fetch|networkerror|load failed|fetch/i.test(msg)) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  return msg;
}
