import { translate, type Locale } from '../../shared/i18n'

let locale: Locale = 'zh-CN'

export function setI18nLocale(next: Locale): void {
  locale = next
}

export function getI18nLocale(): Locale {
  return locale
}

export function t(key: string, params?: Record<string, string | number>): string {
  return translate(locale, key, params)
}
