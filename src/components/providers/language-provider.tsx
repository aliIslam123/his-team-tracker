"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, ReactNode } from "react";
import { translations, Lang, TranslationKey } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey | string) => string;
  dir: "rtl" | "ltr";
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const LANGUAGE_KEY = "lang";
const languageListeners = new Set<() => void>();

/** localStorage is an external store: read it via useSyncExternalStore so the
 *  saved language is available on the client after hydration without setting
 *  state synchronously inside an effect (SSR still renders Arabic). */
function readStoredLang(): Lang {
  try { return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "ar"; } catch { return "ar"; }
}
function subscribeLang(cb: () => void) {
  languageListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === LANGUAGE_KEY || e.key === null) cb(); };
  window.addEventListener("storage", onStorage);
  return () => {
    languageListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
const getLangServerSnapshot = () => "ar" as Lang;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, readStoredLang, getLangServerSnapshot);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try { localStorage.setItem(LANGUAGE_KEY, l); } catch {}
    languageListeners.forEach((cb) => cb());
  }, []);
  const t = useCallback(
    (key: TranslationKey | string) => {
      const dict = translations[lang] as Record<string, string>;
      return dict[key] ?? (translations.en as Record<string, string>)[key] ?? key;
    },
    [lang]
  );
  const value = useMemo(() => ({ lang, setLang, t, dir: (lang === "ar" ? "rtl" : "ltr") as "rtl" | "ltr" }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
