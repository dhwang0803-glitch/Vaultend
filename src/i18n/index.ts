import en from './locales/en';
import ko from './locales/ko';

export type SupportedLocale = 'en' | 'ko';
export type LocaleKey = keyof typeof en;
type InterpolationParams = Record<string, string | number>;

const locales: Record<SupportedLocale, Record<string, string>> = { en, ko };
let currentLocale: SupportedLocale = 'en';

export function setLocale(locale: SupportedLocale): void {
  currentLocale = locale;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export function t(key: LocaleKey, params?: InterpolationParams): string {
  const template = locales[currentLocale]?.[key] ?? locales['en'][key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? `{{${name}}}`),
  );
}

export function formatDate(ts: number): string {
  const locale = currentLocale === 'ko' ? 'ko-KR' : 'en-US';
  return new Date(ts).toLocaleString(locale);
}

export function detectObsidianLocale(): SupportedLocale {
  const win = window as Window & { moment?: { locale?: () => string } };
  const momentGlobal = win.moment;
  if (momentGlobal && typeof momentGlobal.locale === 'function') {
    const loc = momentGlobal.locale();
    if (loc?.startsWith('ko')) return 'ko';
  }
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('ko')) {
    return 'ko';
  }
  return 'en';
}
