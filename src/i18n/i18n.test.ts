import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { currentLanguage, setLanguage, uiLocale } from "./index";
import { detectLanguage, initialLanguage, normalize, STORAGE_KEY } from "./prefs";
import { fmtMoney } from "../lib/format";
import en from "./en";
import pt from "./pt";
import pl from "./pl";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const LANGUAGES = { en, pt, pl } as const;
const KEYS = Object.fromEntries(
  Object.entries(LANGUAGES).map(([lang, tree]) => [lang, flatten(tree as Tree)])
) as Record<keyof typeof LANGUAGES, Record<string, string>>;
const EN_KEYS = KEYS.en;

/** The {{name}} interpolation placeholders used by a string, sorted. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("translation resources", () => {
  it("covers a whole platform, not a couple of strings", () => {
    expect(Object.keys(EN_KEYS).length).toBeGreaterThan(200);
  });

  it("every language defines exactly the same keys as English", () => {
    const expected = Object.keys(EN_KEYS).sort();
    for (const lang of ["pt", "pl"] as const) {
      expect(Object.keys(KEYS[lang]).sort(), lang).toEqual(expected);
    }
  });

  it("has no empty or whitespace-only values in any language", () => {
    for (const [lang, keys] of Object.entries(KEYS)) {
      for (const [key, value] of Object.entries(keys)) {
        expect(value.trim(), `${lang}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("uses the same interpolation placeholders in every language", () => {
    for (const lang of ["pt", "pl"] as const) {
      for (const key of Object.keys(EN_KEYS)) {
        expect(placeholders(KEYS[lang][key]), `${lang}.${key}`).toEqual(
          placeholders(EN_KEYS[key])
        );
      }
    }
  });

  it("translates the headline strings into Portuguese and Polish", () => {
    expect(KEYS.pt["settings.title"]).toBe("Definições");
    expect(KEYS.pt["bills.title"]).toBe("Contas");
    expect(KEYS.pt["labels.months.jan"]).toBe("janeiro");
    expect(KEYS.pt["common.save"]).toBe("Guardar");

    expect(KEYS.pl["settings.title"]).toBe("Ustawienia");
    expect(KEYS.pl["bills.title"]).toBe("Rachunki");
    expect(KEYS.pl["labels.months.jan"]).toBe("styczeń");
    expect(KEYS.pl["common.save"]).toBe("Zapisz");
  });

  it("names the no-settlement option and its paid-by checkbox in every language", () => {
    expect(KEYS.en["settings.settlement.none"]).toBe("No settlement");
    expect(KEYS.pt["settings.settlement.none"]).toBe("Sem acerto de contas");
    expect(KEYS.pl["settings.settlement.none"]).toBe("Bez rozliczeń");

    expect(KEYS.en["settings.settlement.hidePaidBy"]).toBe(
      "Remove Paid By from expenses"
    );
    expect(KEYS.pt["settings.settlement.hidePaidBy"]).toBe(
      "Remover “Pago por” das despesas"
    );
    expect(KEYS.pl["settings.settlement.hidePaidBy"]).toBe(
      "Usuń „Opłacone przez” z wydatków"
    );
  });

  it("keeps language names written in their own language", () => {
    for (const lang of ["en", "pt", "pl"] as const) {
      expect(KEYS[lang]["settings.language.en"]).toBe("English");
      expect(KEYS[lang]["settings.language.pt"]).toBe("Português (Portugal)");
      expect(KEYS[lang]["settings.language.pl"]).toBe("Polski");
    }
  });

  it("offers plural forms where counts are shown", async () => {
    expect(EN_KEYS["bills.count_one"]).toBeDefined();
    expect(EN_KEYS["bills.count_other"]).toBeDefined();
    expect(KEYS.pt["bills.count_one"]).toBe("{{count}} conta");
    expect(KEYS.pt["bills.count_other"]).toBe("{{count}} contas");

    // Polish selects among four plural categories.
    expect(KEYS.pl["bills.count_one"]).toBe("{{count}} rachunek");
    expect(KEYS.pl["bills.count_few"]).toBe("{{count}} rachunki");
    expect(KEYS.pl["bills.count_many"]).toBe("{{count}} rachunków");

    await i18n.changeLanguage("en");
    expect(i18n.t("bills.count", { count: 1 })).toBe("1 bill");
    expect(i18n.t("bills.count", { count: 3 })).toBe("3 bills");
    await i18n.changeLanguage("pt");
    expect(i18n.t("bills.count", { count: 1 })).toBe("1 conta");
    expect(i18n.t("bills.count", { count: 3 })).toBe("3 contas");
    await i18n.changeLanguage("pl");
    expect(i18n.t("bills.count", { count: 1 })).toBe("1 rachunek");
    expect(i18n.t("bills.count", { count: 3 })).toBe("3 rachunki");
    expect(i18n.t("bills.count", { count: 5 })).toBe("5 rachunków");
    expect(i18n.t("bills.count", { count: 0 })).toBe("0 rachunków");
  });
});

describe("language runtime", () => {
  it("switches every translation when the language changes", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("settings.title")).toBe("Settings");
    expect(uiLocale()).toBe("en-GB");

    await setLanguage("pt");
    expect(currentLanguage()).toBe("pt");
    expect(uiLocale()).toBe("pt-PT");
    expect(i18n.t("settings.title")).toBe("Definições");

    await setLanguage("pl");
    expect(currentLanguage()).toBe("pl");
    expect(uiLocale()).toBe("pl-PL");
    expect(i18n.t("settings.title")).toBe("Ustawienia");
    expect(i18n.t("common.save")).toBe("Zapisz");

    await setLanguage("en");
    expect(currentLanguage()).toBe("en");
    expect(i18n.t("settings.title")).toBe("Settings");
  });

  it("falls back to English when a key is missing in another language", async () => {
    i18n.addResource("en", "translation", "fallbackProbe", "English only");
    await setLanguage("pl");
    expect(i18n.t("fallbackProbe" as never)).toBe("English only");
  });

  it("persists the choice to localStorage", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });

    await setLanguage("pl");
    expect(store.get(STORAGE_KEY)).toBe("pl");
    await setLanguage("pt");
    expect(store.get(STORAGE_KEY)).toBe("pt");
    await setLanguage("en");
    expect(store.get(STORAGE_KEY)).toBe("en");
  });
});

describe("language preferences", () => {
  it("recognises supported language tags", () => {
    expect(normalize("en")).toBe("en");
    expect(normalize("en-US")).toBe("en");
    expect(normalize("pt")).toBe("pt");
    expect(normalize("pt-PT")).toBe("pt");
    expect(normalize("pl")).toBe("pl");
    expect(normalize("pl-PL")).toBe("pl");
    expect(normalize("fr")).toBeNull();
    expect(normalize(null)).toBeNull();
    expect(normalize("")).toBeNull();
  });

  it("detects the browser language, English otherwise", () => {
    expect(detectLanguage("pt-PT")).toBe("pt");
    expect(detectLanguage("pl-PL")).toBe("pl");
    expect(detectLanguage("pl")).toBe("pl");
    expect(detectLanguage("en-GB")).toBe("en");
    expect(detectLanguage("fr-FR")).toBe("en");
    expect(detectLanguage(undefined)).toBe("en");
  });

  it("prefers the stored choice over the browser language", () => {
    const store = new Map<string, string>([[STORAGE_KEY, "pl"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    expect(initialLanguage("en-US")).toBe("pl");

    store.delete(STORAGE_KEY);
    expect(initialLanguage("pl-PL")).toBe("pl");
    expect(initialLanguage("pt-PT")).toBe("pt");
    expect(initialLanguage("en-GB")).toBe("en");
    expect(initialLanguage("fr")).toBe("en");
  });
});

describe("money formatting follows the language", () => {
  it("formats EUR per locale", async () => {
    await setLanguage("en");
    const english = fmtMoney(1234.5);
    await setLanguage("pt");
    const portuguese = fmtMoney(1234.5);
    await setLanguage("pl");
    const polish = fmtMoney(1234.5);

    expect(english).toMatch(/1,234\.50/);
    expect(portuguese).toMatch(/234,50/);
    expect(polish).toMatch(/234,50/);
    expect(polish).not.toBe(english);
  });
});
