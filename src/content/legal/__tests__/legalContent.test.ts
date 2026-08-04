import { describe, it, expect } from 'vitest';
import { LEGAL_CONTENT, LEGAL_DOCUMENT_KEYS, getLegalDocument } from '../index';
import { PLACEHOLDER } from '../types';

/**
 * Legal content lives outside src/messages/*.json, so i18nKeys.test.ts — which
 * proves every t('key') resolves in BOTH locales — cannot see it. This restores
 * that guarantee for the documents where a missing translation is most costly:
 * a French household must never be shown an English privacy policy, and a
 * section present in one locale but not the other is a document that says
 * different things to different people.
 *
 * The registry is walked exhaustively rather than enumerated here, so a new
 * document is covered the moment it is added.
 */

const LOCALES = ['en', 'fr'] as const;

describe('legal content parity across locales', () => {
  it('the registry actually contains something to check', () => {
    // Guards against the whole suite passing vacuously if the registry breaks.
    expect(LEGAL_DOCUMENT_KEYS.length).toBeGreaterThan(0);
  });

  for (const doc of LEGAL_DOCUMENT_KEYS) {
    describe(doc, () => {
      it('exists in every locale with a title and a date', () => {
        for (const locale of LOCALES) {
          const d = LEGAL_CONTENT[doc][locale];
          expect(d, `${doc}.${locale} missing`).toBeTruthy();
          expect(d.title.trim().length).toBeGreaterThan(0);
          expect(d.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });

      it('has the SAME section ids in the SAME order in both locales', () => {
        const en = LEGAL_CONTENT[doc].en.sections.map((s) => s.id);
        const fr = LEGAL_CONTENT[doc].fr.sections.map((s) => s.id);
        // Order matters as much as membership: ids are URL anchors, and a
        // section that moves between locales makes a shared link land in the
        // wrong place.
        expect(fr).toEqual(en);
      });

      it('has unique, url-safe section ids', () => {
        for (const locale of LOCALES) {
          const ids = LEGAL_CONTENT[doc][locale].sections.map((s) => s.id);
          expect(new Set(ids).size, `${doc}.${locale} has duplicate ids`).toBe(ids.length);
          for (const id of ids) {
            // Never translated, so never accented or spaced.
            expect(id, `${doc}.${locale}: "${id}" is not url-safe`).toMatch(/^[a-z0-9-]+$/);
          }
        }
      });

      it('every section has a heading and at least one paragraph in every locale', () => {
        for (const locale of LOCALES) {
          for (const s of LEGAL_CONTENT[doc][locale].sections) {
            expect(s.heading.trim().length, `${doc}.${locale}#${s.id} heading`).toBeGreaterThan(0);
            expect(s.body.length, `${doc}.${locale}#${s.id} body`).toBeGreaterThan(0);
            for (const p of s.body) {
              expect(p.trim().length, `${doc}.${locale}#${s.id} empty paragraph`).toBeGreaterThan(0);
            }
          }
        }
      });

      it('headings are actually translated, not copy-pasted English', () => {
        // Catches the failure where a section was added to fr by duplicating en
        // and the prose was never translated. Some headings legitimately match
        // across languages (proper nouns, "Phare"), so this asserts that MOST
        // differ rather than all.
        const en = LEGAL_CONTENT[doc].en.sections;
        const fr = LEGAL_CONTENT[doc].fr.sections;
        const identical = en.filter((s, i) => s.heading === fr[i].heading).length;
        expect(identical, `${doc}: ${identical}/${en.length} headings identical in fr`)
          .toBeLessThan(Math.ceil(en.length / 2));
      });
    });
  }

  it('getLegalDocument falls back to English rather than throwing', () => {
    // A legal page must always render. An unknown locale is a routing bug, not
    // a reason to show a stack trace where the privacy policy should be.
    expect(getLegalDocument('privacy', 'de')).toBe(LEGAL_CONTENT.privacy.en);
    expect(getLegalDocument('privacy', 'fr')).toBe(LEGAL_CONTENT.privacy.fr);
  });
});

describe('drafting progress', () => {
  // Not a failure — placeholder copy is the expected state until the founder
  // writes the real text. This reports what is left so it cannot be forgotten,
  // and the assertion below is what turns "we shipped [DRAFT] text to
  // production" from a possibility into a test failure once drafting is done.
  it('reports how many paragraphs are still placeholders', () => {
    let total = 0;
    let draft = 0;
    for (const doc of LEGAL_DOCUMENT_KEYS) {
      for (const locale of LOCALES) {
        const d = LEGAL_CONTENT[doc][locale];
        for (const p of d.intro ?? []) { total++; if (p.startsWith(PLACEHOLDER)) draft++; }
        for (const s of d.sections) {
          for (const p of s.body) { total++; if (p.startsWith(PLACEHOLDER)) draft++; }
        }
      }
    }
    console.log(`[legal] ${draft}/${total} paragraphs still placeholder copy`);
    expect(total).toBeGreaterThan(0);
  });

  it('NO placeholder copy remains — the permanent tripwire against shipping drafts', () => {
    for (const doc of LEGAL_DOCUMENT_KEYS) {
      for (const locale of LOCALES) {
        const d = LEGAL_CONTENT[doc][locale];
        const all = [...(d.intro ?? []), ...d.sections.flatMap((s) => s.body)];
        for (const p of all) {
          expect(p.startsWith(PLACEHOLDER), `${doc}.${locale} still has draft copy`).toBe(false);
        }
      }
    }
  });
});
