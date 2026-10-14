import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Trans, useTranslation } from "react-i18next";
import { supabase } from "../db/supabase";
import { fetchHousehold, refreshHousehold } from "../db/householdApi";
import {
  getHouseholdSnapshot, onHouseholdChange,
  setHousehold as setActiveHousehold, type Household,
} from "../db/household";
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
  const { t } = useTranslation();
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
    // Claim first: a pending (email-only) membership row becomes bound to this
    // account's userId (migration 0017) before the household resolves. Never
    // blocks sign-in if the RPC is unavailable. The household resolves before
    // the app mounts, so the data layer has a household to scope every query to.
    (async () => {
      try {
        await supabase.rpc("claim_pending_membership");
      } catch {
        // best-effort: an older database just means no pending row to claim
      }
      return fetchHousehold();
    })()
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

  // Mirror module-state changes (a partner joining, a merge or a dismantle
  // from Settings) into the gate: a cleared household drops to Onboarding, a
  // new one re-renders the app on the fresh data.
  useEffect(() => {
    if (!session) return;
    return onHouseholdChange(() => {
      setHouseholdState(getHouseholdSnapshot());
    });
  }, [session?.user.id]);

  // Membership changes for the active household arrive live: the other device
  // sees the second member join (the Settings box disappears), and a dismantle
  // hands each member their own copy without a reload.
  useEffect(() => {
    if (!household?.id) return;
    const channel = supabase
      .channel(`household-members-${household.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_members",
          filter: `householdId=eq.${household.id}`,
        },
        () => {
          refreshHousehold().catch(() => {});
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [household?.id]);

  if (loading) return <Centered>{t("common.loading")}</Centered>;
  if (!session) return <SignIn />;
  if (failed) return <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />;
  if (household === undefined) return <Centered>{t("auth.checkingAccess")}</Centered>;
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
  const { t } = useTranslation();
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
        <p className="subtitle">{t("auth.signIn.prompt")}</p>
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
          {t("auth.signIn.google")}
        </button>

        <p className="subtitle" style={{ margin: "16px 0 8px" }}>{t("auth.signIn.or")}</p>
        {sent ? (
          <p className="subtitle" style={{ margin: 0 }}>
            <Trans
              i18nKey="auth.signIn.sent"
              values={{ email: email.trim() }}
              components={{ strong: <strong /> }}
            />
          </p>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <input
                type="email"
                placeholder={t("auth.signIn.emailPlaceholder")}
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendLink();
                }}
              />
              <button onClick={sendLink} disabled={busy || !email.trim()}>
                {busy ? t("auth.signIn.sending") : t("auth.signIn.emailLink")}
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
  const { t } = useTranslation();
  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 className="brand" style={{ marginTop: 0 }}>{t("auth.loadFailed.title")}</h1>
        <p className="subtitle">{t("auth.loadFailed.body")}</p>
        <button className="primary" onClick={onRetry}>
          {t("auth.loadFailed.retry")}
        </button>
      </div>
    </Centered>
  );
}
