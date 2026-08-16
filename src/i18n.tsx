import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "zh-CN" | "en-GB";

const LOCALE_STORAGE_KEY = "stmweb-locale";

function detectLocale(): AppLocale {
  if (typeof navigator === "undefined") return "zh-CN";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en-GB";
}

function resolveInitialLocale(): AppLocale {
  if (typeof window !== "undefined") {
    try {
      const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (storedLocale === "zh-CN" || storedLocale === "en-GB") return storedLocale;
    } catch {
      // Some privacy modes block storage; browser-language detection remains available.
    }
  }
  return detectLocale();
}

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({ locale: "zh-CN", setLocale: () => undefined });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(resolveInitialLocale);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Keep the current page switchable when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const { locale, setLocale } = useContext(LocaleContext);
  return {
    locale,
    isEnglish: locale === "en-GB",
    dateLocale: locale,
    legalLocale: locale === "en-GB" ? "en-GB" : "zh-CN",
    setLocale,
    toggleLocale: () => setLocale(locale === "en-GB" ? "zh-CN" : "en-GB"),
  } as const;
}
