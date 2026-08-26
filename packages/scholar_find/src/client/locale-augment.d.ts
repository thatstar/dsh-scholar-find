/**
 * Client-side module augmentation: registers the `dsh-scholar-find` locale
 * namespace with the slots type system so the card's `PropsLocale` seat and
 * `slots.register({ locale: 'dsh-scholar-find' })` type-check (same pattern every
 * client package uses to contribute its own dictionary namespace).
 */

import type { ScholarLocaleKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-scholar-find': ScholarLocaleKey
  }
}