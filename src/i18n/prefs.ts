// Language preference storage — pure functions, no i18next dependency, so the
// rules (stored choice beats browser detection) are testable on their own.

export type Language = "en" | "pt";

export const LANGUAGES: readonly Language[] = ["en", "pt"] as const;

export const STORAGE_KEY = "expense-tracker.language";

/** Map a browser/storage language tag onto a supported language, or null. */
export function normalize(value: string | null | undefined): Language | null {
  if (!value) return null;
  const tag = value.toLowerCase();
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "pt" || tag.startsWith("pt-")) return "pt";
  return null;
}

/** The language saved on this device, if any. */
export function readStored(): Language | null {
  try {
    return normalize(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return null; // storage disabled (private mode, blocked cookies, …)
  }
}

export function writeStored(lang: Language): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // storage disabled — the language still applies for this session
  }
}

/** What the browser reports: Portuguese for pt-* tags, English otherwise. */
export function detectLanguage(browserLanguage?: string | null): Language {
  return normalize(browserLanguage) === "pt" ? "pt" : "en";
}

/** The language to start with: the stored choice, else the browser's. */
export function initialLanguage(browserLanguage?: string | null): Language {
  return readStored() ?? detectLanguage(browserLanguage);
}
