import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../db/supabase";

/**
 * Wraps the whole app. Renders children only for a signed-in Google account
 * whose email is on the server-side allowlist (checked via the is_allowed()
 * RPC). Everyone else sees a sign-in or "not authorized" screen. The real
 * enforcement is RLS in the database; this is just clean UX on top of it.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);

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
      setAllowed(null);
      return;
    }
    supabase.rpc("is_allowed").then(({ data, error }) => {
      setAllowed(error ? false : Boolean(data));
    });
  }, [session]);

  if (loading) return <Centered>Loading…</Centered>;
  if (!session) return <SignIn />;
  if (allowed === null) return <Centered>Checking access…</Centered>;
  if (!allowed) return <NotAllowed email={session.user.email ?? ""} />;
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
