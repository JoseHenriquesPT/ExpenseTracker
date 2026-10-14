import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../db/supabase";
import { fetchHousehold } from "../db/onboarding";
import { setHousehold as setActiveHousehold, type Household } from "../db/household";
import Onboarding from "./Onboarding";

/**
 * Wraps the whole app. Renders children only for a signed-in Google account
 * whose email is on the server-side allowlist (checked via the is_allowed()
 * RPC) and that belongs to a household (checked via the current_household()
 * RPC). Accounts without a household get the Onboarding screen; everyone else
 * sees a sign-in / "not authorized" screen. The real enforcement is RLS in the
 * database; this is just clean UX on top of it.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [household, setHouseholdState] = useState<Household | null>(null);
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
      setAllowed(null);
      setHouseholdState(null);
      setFailed(false);
      return;
    }
    let alive = true;
    setAllowed(null);
    setHouseholdState(null);
    setFailed(false);
    supabase.rpc("is_allowed").then(async ({ data, error }) => {
      if (!alive) return;
      if (error || !data) {
        setAllowed(false);
        return;
      }
      // Access and household resolve together, so the app only mounts once
      // the data layer has a household to scope every query to.
      try {
        const resolved = await fetchHousehold();
        if (!alive) return;
        setActiveHousehold(resolved);
        setHouseholdState(resolved);
        setAllowed(true);
      } catch {
        if (!alive) return;
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [session, attempt]);

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <SignIn />;
  if (failed) return <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />;
  if (allowed === null) return <Centered>Checking access…</Centered>;
  if (!allowed) return <NotAllowed email={session.user.email ?? ""} />;
  if (household == null) {
    return (
      <Onboarding
        email={session.user.email ?? ""}
        onDone={() => setAttempt((n) => n + 1)}
      />
    );
  }
  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

function SignIn() {
  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 380, textAlign: "center" }}>
        <h1 className="brand" style={{ marginTop: 0 }}>💰 Expense Tracker</h1>
        <p className="subtitle">Private. Sign in to continue.</p>
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
      </div>
    </Centered>
  );
}

function NotAllowed({ email }: { email: string }) {
  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 className="brand" style={{ marginTop: 0 }}>🔒 No access</h1>
        <p className="subtitle">
          <strong>{email}</strong> isn’t on the allowlist for this tracker.
        </p>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
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
