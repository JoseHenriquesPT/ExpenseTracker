import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import pt from "./pt";
import { initialLanguage, writeStored, type Language } from "./prefs";

export type { Language } from "./prefs";

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
  },
  lng: initialLanguage(browserLanguage),
  fallbackLng: "en",
  supportedLngs: ["en", "pt"],
  interpolation: { escapeValue: false },
});

/** Keep <html lang> in step so screen readers and CSS react to the language. */
function applyDocumentLanguage(lng: string): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng.startsWith("pt") ? "pt-PT" : "en";
  }
}

applyDocumentLanguage(i18n.language);
i18n.on("languageChanged", (lng) => {
  writeStored(lng.startsWith("pt") ? "pt" : "en");
  applyDocumentLanguage(lng);
});

/** The supported language currently in effect ("en" | "pt"). */
export function currentLanguage(): Language {
  return i18n.language.startsWith("pt") ? "pt" : "en";
}

/** BCP-47 locale for number/date formatting in the current language. */
export function uiLocale(): string {
  return currentLanguage() === "pt" ? "pt-PT" : "en-GB";
}

export async function setLanguage(lang: Language): Promise<void> {
  await i18n.changeLanguage(lang);
}

export default i18n;
