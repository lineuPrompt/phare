import React, { createContext, useContext, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import en from './messages/en.json';
import fr from './messages/fr.json';
import {
  makeTranslator,
  type Catalog,
  type Locale,
  type Translator,
} from './catalog';

const CATALOGS: Record<Locale, Catalog> = {
  en: en as Catalog,
  fr: fr as Catalog,
};

/**
 * The device's language, narrowed to the two Phare speaks.
 *
 * getLocales() is ordered by the user's own preference list, so the first
 * entry that is one of ours wins — a device set to [de, fr, en] gets French,
 * not English. Anything with no match at all falls back to English.
 *
 * `languageCode` is the bare subtag ('fr' for fr-CA and fr-FR alike), which is
 * the right granularity here: the catalogue is Québécois French and there is
 * no second French to choose between.
 */
export function detectLocale(): Locale {
  for (const locale of getLocales()) {
    if (locale.languageCode === 'fr') return 'fr';
    if (locale.languageCode === 'en') return 'en';
  }
  return 'en';
}

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translator;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  /** Injectable so a screen rendered before the provider (the time-zone
   *  failure gate) can still be given a locale explicitly. */
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? detectLocale());

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: makeTranslator(CATALOGS[locale]) }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n called outside I18nProvider');
  return value;
}

/**
 * Translator for a locale, with no React involved.
 *
 * The time-zone gate renders BEFORE any provider mounts — that is the point of
 * it — so it needs this rather than the hook.
 */
export function translatorFor(locale: Locale): Translator {
  return makeTranslator(CATALOGS[locale]);
}

export { LOCALES, type Locale } from './catalog';
export { CATALOGS };
