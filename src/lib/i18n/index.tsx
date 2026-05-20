import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import en from './en';
import zh from './zh';
import type { Locale } from './en';

export type Lang = 'en' | 'zh';

const locales: Record<Lang, Locale> = { en, zh };

const LANGS: Record<Lang, string> = { en: 'English', zh: '中文' };

const STORAGE_KEY = 'falari_lang';

interface I18nContextValue {
  t: Locale;
  lang: Lang;
  setLang: (lang: Lang) => void;
  availableLangs: Record<Lang, string>;
}

const I18nContext = createContext<I18nContextValue>({
  t: en,
  lang: 'en',
  setLang: () => {},
  availableLangs: LANGS,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  React.useEffect(() => {
    (async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        if (result[STORAGE_KEY] && locales[result[STORAGE_KEY] as Lang]) {
          setLangState(result[STORAGE_KEY] as Lang);
        } else {
          const browserLang = navigator.language.split('-')[0];
          if (browserLang === 'zh') {
            setLangState('zh');
            await chrome.storage.local.set({ [STORAGE_KEY]: 'zh' });
          }
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const setLang = useCallback(async (newLang: Lang) => {
    setLangState(newLang);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: newLang });
    } catch {
      // ignore
    }
  }, []);

  return (
    <I18nContext.Provider value={{ t: locales[lang], lang, setLang, availableLangs: LANGS }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
