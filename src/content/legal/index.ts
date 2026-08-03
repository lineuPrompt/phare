import type { LegalDocument, LegalDocumentKey, LegalLocale } from './types';
import privacyEn from './privacy.en';
import privacyFr from './privacy.fr';
import termsEn from './terms.en';
import termsFr from './terms.fr';
import faqEn from './faq.en';
import faqFr from './faq.fr';

/**
 * The registry. Every document, every locale, in one object so the parity test
 * can walk it exhaustively rather than being told which files to check — a test
 * that has to be updated to notice a new document is a test that will miss one.
 */
export const LEGAL_CONTENT: Record<LegalDocumentKey, Record<LegalLocale, LegalDocument>> = {
  privacy: { en: privacyEn, fr: privacyFr },
  terms: { en: termsEn, fr: termsFr },
  faq: { en: faqEn, fr: faqFr },
};

export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_CONTENT) as LegalDocumentKey[];

/** Falls back to English for an unrecognized locale rather than throwing — a
 *  legal page must always render something. */
export function getLegalDocument(doc: LegalDocumentKey, locale: string): LegalDocument {
  const byLocale = LEGAL_CONTENT[doc];
  return byLocale[(locale === 'fr' ? 'fr' : 'en') as LegalLocale];
}

export type { LegalDocument, LegalDocumentKey, LegalLocale };
