import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../db/supabase";
import { fetchHousehold } from "../db/householdApi";
import { setHousehold as setActiveHousehold, type Household } from "../db/household";
import { toMessage } from "../lib/errors";
import Centered from "../components/Centered";
import Onboarding from "./Onboarding";

/**
 * Wraps the whole app. Renders children only for a signed-in account that
 * belongs to a household (resolved via the current_household() RPC). Accounts
 * without one get the Onboarding screen; anyone not signed in sees the sign-in
 * screen. The real enforcement is RLS in the database; this is just clean UX on
 * top of it.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // undefined = still checking; null = checked, no household yet.
  const [household, setHouseholdState] = useState<Household | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setActiveHousehold(null);
      setHouseholdState(undefined);
      setFailed(false);
      return;
    }
    let alive = true;
    setHouseholdState(undefined);
    setFailed(false);
    // The household resolves before the app mounts, so the data layer has a
    // household to scope every query to.
    fetchHousehold()
      .then((resolved) => {
        if (!alive) return;
        setActiveHousehold(resolved);
        setHouseholdState(resolved);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // Keyed on the user id, not the session object: Supabase fires
    // TOKEN_REFRESHED (roughly hourly) with a fresh session object for the same
    // user, and re-running would flash the checking screen and refetch.
  }, [session?.user.id, attempt]);

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <SignIn />;
  if (failed) return <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />;
  if (household === undefined) return <Centered>Checking access…</Centered>;
  if (household === null) {
    return (
      <Onboarding
        email={session.user.email ?? ""}
        onDone={() => setAttempt((n) => n + 1)}
      />
    );
  }
  return <>{children}</>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendLink() {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) setError(toMessage(err));
    else setSent(true);
  }

  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 380, textAlign: "center" }}>
        <h1 className="brand" style={{ marginTop: 0 }}>💰 Expense Tracker</h1>
        <p className="subtitle">Sign in to continue.</p>
        <button
          className="primary"
          style={{ width: "100%" }}
          onClick={() =>
            supabase.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: window.location.origin },
            })
          }
        >
          Sign in with Google
        </button>

        <p className="subtitle" style={{ margin: "16px 0 8px" }}>or</p>
        {sent ? (
          <p className="subtitle" style={{ margin: 0 }}>
            Link sent — check <strong>{email.trim()}</strong> for the sign-in email.
          </p>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendLink();
                }}
              />
              <button onClick={sendLink} disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
            </div>
            {error && <p style={{ color: "var(--red)", marginBottom: 0 }}>{error}</p>}
          </>
        )}
      </div>
    </Centered>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 className="brand" style={{ marginTop: 0 }}>⚠ Couldn’t load your household</h1>
        <p className="subtitle">
          Something went wrong talking to the server. Check your connection and try again.
        </p>
        <button className="primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </Centered>
  );
}
