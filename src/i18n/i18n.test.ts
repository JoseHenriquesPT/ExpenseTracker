import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { currentLanguage, setLanguage, uiLocale } from "./index";
import { detectLanguage, initialLanguage, normalize, STORAGE_KEY } from "./prefs";
import { fmtMoney } from "../lib/format";
import en from "./en";
import pt from "./pt";

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

const enKeys = flatten(en as Tree);
const ptKeys = flatten(pt as Tree);

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
    expect(Object.keys(enKeys).length).toBeGreaterThan(200);
  });

  it("pt defines exactly the same keys as en", () => {
    expect(Object.keys(ptKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it("has no empty or whitespace-only values", () => {
    for (const [key, value] of [...Object.entries(enKeys), ...Object.entries(ptKeys)]) {
      expect(value.trim(), `${key} is empty`).not.toBe("");
    }
  });

  it("uses the same interpolation placeholders in both languages", () => {
    for (const key of Object.keys(enKeys)) {
      expect(placeholders(ptKeys[key]), key).toEqual(placeholders(enKeys[key]));
    }
  });

  it("translates the headline strings into Portuguese", () => {
    expect(ptKeys["settings.title"]).toBe("Definições");
    expect(ptKeys["home.settings"]).toBe("Definições");
    expect(ptKeys["bills.title"]).toBe("Contas");
    expect(ptKeys["auth.signIn.prompt"]).toBe("Inicie sessão para continuar.");
    expect(ptKeys["labels.months.jan"]).toBe("janeiro");
    expect(ptKeys["common.save"]).toBe("Guardar");
  });

  it("keeps language names written in their own language", () => {
    expect(enKeys["settings.language.en"]).toBe("English");
    expect(ptKeys["settings.language.en"]).toBe("English");
    expect(enKeys["settings.language.pt"]).toBe("Português (Portugal)");
    expect(ptKeys["settings.language.pt"]).toBe("Português (Portugal)");
  });

  it("offers plural forms where counts are shown", async () => {
    expect(enKeys["bills.count_one"]).toBeDefined();
    expect(enKeys["bills.count_other"]).toBeDefined();
    expect(ptKeys["bills.count_one"]).toBe("{{count}} conta");
    expect(ptKeys["bills.count_other"]).toBe("{{count}} contas");

    await i18n.changeLanguage("en");
    expect(i18n.t("bills.count", { count: 1 })).toBe("1 bill");
    expect(i18n.t("bills.count", { count: 3 })).toBe("3 bills");
    await i18n.changeLanguage("pt");
    expect(i18n.t("bills.count", { count: 1 })).toBe("1 conta");
    expect(i18n.t("bills.count", { count: 3 })).toBe("3 contas");
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
    expect(i18n.t("common.save")).toBe("Guardar");

    await setLanguage("en");
    expect(currentLanguage()).toBe("en");
    expect(i18n.t("settings.title")).toBe("Settings");
  });

  it("falls back to English when a key is missing in Portuguese", async () => {
    i18n.addResource("en", "translation", "fallbackProbe", "English only");
    await setLanguage("pt");
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
    expect(normalize("pt-BR")).toBe("pt");
    expect(normalize("fr")).toBeNull();
    expect(normalize(null)).toBeNull();
    expect(normalize("")).toBeNull();
  });

  it("detects Portuguese from the browser language, English otherwise", () => {
    expect(detectLanguage("pt-PT")).toBe("pt");
    expect(detectLanguage("pt-BR")).toBe("pt");
    expect(detectLanguage("en-GB")).toBe("en");
    expect(detectLanguage("fr-FR")).toBe("en");
    expect(detectLanguage(undefined)).toBe("en");
  });

  it("prefers the stored choice over the browser language", () => {
    const store = new Map<string, string>([[STORAGE_KEY, "pt"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    expect(initialLanguage("en-US")).toBe("pt");

    store.delete(STORAGE_KEY);
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

    expect(english).toMatch(/1,234\.50/);
    expect(portuguese).toMatch(/234,50/);
    expect(portuguese).not.toBe(english);
  });
});
