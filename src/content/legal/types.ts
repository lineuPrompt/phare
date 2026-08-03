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

export type LegalSection = {
  /**
   * Stable, locale-independent identifier. It is the anchor in the URL, and it
   * is what the parity test compares across locales — so it must NEVER be
   * translated, and must not change once published (an external link or a
   * regulator's citation may point at it).
   */
  id: string;
  heading: string;
  /** One string per paragraph. Rendered as separate <p> elements. */
  body: string[];
};

export type LegalDocument = {
  title: string;
  /**
   * Shown to the reader. Keep in step with CURRENT_LEGAL_VERSION in
   * src/lib/legalVersions.ts when the substance changes — a document claiming
   * one date while consent is recorded against another is the exact ambiguity
   * the version column exists to remove.
   */
  lastUpdated: string;
  /** Optional lead paragraphs before the first numbered section. */
  intro?: string[];
  sections: LegalSection[];
};

export type LegalDocumentKey = 'privacy' | 'terms' | 'faq';
export type LegalLocale = 'en' | 'fr';

/** Placeholder marker. legalContent.test.ts reports how much copy is still TODO. */
export const PLACEHOLDER = '[DRAFT] ';
