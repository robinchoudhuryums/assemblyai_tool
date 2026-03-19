import { useState, useCallback, type ReactNode } from "react";
import { I18nContext, getTranslation, getSavedLocale, saveLocale, type Locale } from "@/lib/i18n";

export default function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getSavedLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    saveLocale(newLocale);
  }, []);

  const t = useCallback((key: string) => getTranslation(locale, key), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}
