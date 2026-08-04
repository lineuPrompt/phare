import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '../en.json';
import fr from '../fr.json';

/**
 * `consentLabel` is a RICH message with <terms> and <privacy> tags. The global
 * i18nKeys test only scans `t('key')` calls, so `t.rich(...)` is invisible to
 * it — and a rich message with an unclosed or misspelled tag still resolves to
 * a perfectly good string, then throws when formatted. On the consent screen,
 * that would be a crash on the one page a user cannot get past.
 *
 * So the tags are actually formatted here, in both locales.
 */

const locales = [
  { name: 'en', messages: en },
  { name: 'fr', messages: fr },
] as const;

describe('legal namespace', () => {
  for (const { name, messages } of locales) {
    describe(name, () => {
      const t = createTranslator({ locale: name, messages, namespace: 'legal' });

      it('consentCheckbox formats with both link tags', () => {
        const out = t.rich('consentCheckbox', {
          terms: (c) => `[TERMS:${c}]`,
          privacy: (c) => `[PRIVACY:${c}]`,
        });
        const text = Array.isArray(out) ? out.join('') : String(out);

        // Both tags must actually fire — a typo'd tag name silently renders
        // nothing where the link should be, leaving "I agree to the  and the ".
        expect(text).toContain('[TERMS:');
        expect(text).toContain('[PRIVACY:');
        // And the tag markup must be fully consumed.
        expect(text).not.toContain('<terms>');
        expect(text).not.toContain('<privacy>');
      });

      it('lastUpdated interpolates the date', () => {
        const out = t('lastUpdated', { date: '2026-08-03' });
        expect(out).toContain('2026-08-03');
        expect(out).not.toContain('{');
      });

      it('every plain key the legal surfaces use is present and non-empty', () => {
        const keys = ['footerPrivacy', 'footerTerms', 'footerFaq', 'backHome',
                      'consentAiNote', 'consentRequired', 'acceptTitle', 'acceptTitleUpdated',
                      'acceptBodyNew', 'acceptBodyUpdated', 'acceptButton',
                      'accepting', 'acceptFailed'] as const;
        for (const key of keys) {
          expect(t(key).length, `${name}.${key}`).toBeGreaterThan(0);
        }
      });
    });
  }

  it('the French copy is actually translated', () => {
    const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'legal' });
    const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'legal' });
    // 'FAQ' is legitimately identical in both, so it is excluded.
    for (const key of ['footerPrivacy', 'footerTerms', 'acceptTitle', 'acceptButton'] as const) {
      expect(tFr(key), `${key} was never translated`).not.toBe(tEn(key));
    }
  });
});
