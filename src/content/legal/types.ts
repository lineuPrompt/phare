/**
 * Shape of a legal/informational document.
 *
 * These live here rather than in src/messages/*.json on purpose:
 *   - next-intl ships a whole namespace to the client, so long-form prose in
 *     the message files would be downloaded by every page that mounts a
 *     provider, not just the one page that renders it.
 *   - legal text is revised in prose-sized chunks, and a JSON diff of escaped
 *     newlines is unreviewable — which matters most for exactly the documents
 *     where a wrong word is a liability.
 *   - t('key') is built for short interpolated strings, not for paragraphs.
 *
 * The cost of moving out of the message files is that i18nKeys.test.ts no
 * longer guarantees both locales exist. legalContent.test.ts restores that
 * guarantee by asserting each document is present in en AND fr with the SAME
 * section ids in the SAME order.
 */

// LegalSection and LegalDocument are defined once, in @phare/core
// (privacyPolicy.ts), next to the Privacy Policy the mobile app also renders.
export type { LegalSection, LegalDocument } from '@phare/core';


export type LegalDocumentKey = 'privacy' | 'terms' | 'faq';
export type LegalLocale = 'en' | 'fr';

/** Placeholder marker. legalContent.test.ts reports how much copy is still TODO. */
export const PLACEHOLDER = '[DRAFT] ';
