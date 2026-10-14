import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { createHousehold, joinHousehold } from "../db/householdApi";
import { supabase } from "../db/supabase";
import { toMessage } from "../lib/errors";
import Centered from "../components/Centered";

/**
 * First-run screen for a signed-in account that doesn't belong to a household
 * yet: start alone, start as a pair, or join an existing household with an
 * invite code. Rendered by AuthGate in place of the app.
 */
export default function Onboarding({ email, onDone }: { email: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"single" | "couple" | "join" | null>(null);
  const [error, setError] = useState("");

  async function run(which: "single" | "couple" | "join") {
    setBusy(which);
    setError("");
    try {
      if (which === "join") await joinHousehold(code);
      else await createHousehold(which);
      onDone();
    } catch (e) {
      setError(toMessage(e));
      setBusy(null);
    }
  }

  return (
    <Centered>
      <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
        <h1 className="brand" style={{ marginTop: 0, textAlign: "center" }}>
          💰 Expense Tracker
        </h1>
        <p className="subtitle" style={{ textAlign: "center" }}>
          <Trans
            i18nKey="auth.onboarding.signedInAs"
            values={{ email }}
            components={{ strong: <strong /> }}
          />
        </p>

        <button
          className="primary"
          style={{ width: "100%", marginBottom: 4 }}
          disabled={busy != null}
          onClick={() => run("single")}
        >
          {busy === "single" ? t("auth.onboarding.settingUp") : t("auth.onboarding.justMe")}
        </button>
        <p className="subtitle" style={{ textAlign: "center", fontSize: 13 }}>
          {t("auth.onboarding.justMeDesc")}
        </p>

        <button
          style={{ width: "100%", marginBottom: 4 }}
          disabled={busy != null}
          onClick={() => run("couple")}
        >
          {busy === "couple" ? t("auth.onboarding.settingUp") : t("auth.onboarding.couple")}
        </button>
        <p className="subtitle" style={{ textAlign: "center", fontSize: 13 }}>
          {t("auth.onboarding.coupleDesc")}
        </p>

        <hr style={{ borderColor: "var(--border)", margin: "18px 0 14px" }} />

        <label className="subtitle" style={{ display: "block", marginBottom: 8 }}>
          {t("auth.onboarding.invitePrompt")}
        </label>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("auth.onboarding.invitePlaceholder")}
            disabled={busy != null}
          />
          <button disabled={busy != null || !code.trim()} onClick={() => run("join")}>
            {busy === "join" ? t("auth.onboarding.joining") : t("auth.onboarding.join")}
          </button>
        </div>

        {error && <p style={{ color: "var(--red)", marginBottom: 8 }}>{error}</p>}

        <button className="ghost" onClick={() => supabase.auth.signOut()} disabled={busy != null}>
          {t("auth.signOut")}
        </button>
      </div>
    </Centered>
  );
}
