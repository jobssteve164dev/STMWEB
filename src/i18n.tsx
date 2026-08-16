import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

export type AppLocale = "zh-CN" | "en-GB";

function detectLocale(): AppLocale {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en-GB";
}

const LocaleContext = createContext<AppLocale>("zh-CN");

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useMemo(detectLocale, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  return {
    locale,
    isEnglish: locale === "en-GB",
    dateLocale: locale,
    legalLocale: locale === "en-GB" ? "en-GB" : "zh-CN",
  } as const;
}
