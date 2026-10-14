import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import pt from "./pt";
import pl from "./pl";
import { initialLanguage, normalize, writeStored, type Language } from "./prefs";

export type { Language } from "./prefs";
export { LANGUAGES, STORAGE_KEY } from "./prefs";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

const browserLanguage =
  typeof navigator !== "undefined" ? navigator.language : undefined;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
    pl: { translation: pl },
  },
  lng: initialLanguage(browserLanguage),
  fallbackLng: "en",
  supportedLngs: ["en", "pt", "pl"],
  interpolation: { escapeValue: false },
});

/** Keep <html lang> in step so screen readers and CSS react to the language. */
function applyDocumentLanguage(lng: string): void {
  if (typeof document === "undefined") return;
  const lang = normalize(lng) ?? "en";
  document.documentElement.lang = lang === "pt" ? "pt-PT" : lang;
}

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", (lng) => {
  writeStored(normalize(lng) ?? "en");
  applyDocumentLanguage(lng);
});

/** The supported language currently in effect ("en" | "pt" | "pl"). */
export function currentLanguage(): Language {
  return normalize(i18n.language) ?? "en";
}

/** BCP-47 locale for number/date formatting in the current language. */
export function uiLocale(): string {
  switch (currentLanguage()) {
    case "pt":
      return "pt-PT";
    case "pl":
      return "pl-PL";
    default:
      return "en-GB";
  }
}

export async function setLanguage(lang: Language): Promise<void> {
  await i18n.changeLanguage(lang);
}

export default i18n;
