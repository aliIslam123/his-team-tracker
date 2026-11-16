"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { translations, Lang, TranslationKey } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey | string) => string;
  dir: "rtl" | "ltr";
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [ready, setReady] = useState(false);

  // restore the saved language once on the client (SSR always renders Arabic to avoid hydration mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("lang");
      if (stored === "ar" || stored === "en") setLangState(stored);
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    if (ready) {
      try { localStorage.setItem("lang", lang); } catch {}
    }
  }, [lang, ready]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
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
