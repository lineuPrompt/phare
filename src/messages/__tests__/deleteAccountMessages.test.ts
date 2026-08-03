import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '../en.json';
import fr from '../fr.json';

/**
 * The global i18nKeys test proves every t('key') RESOLVES to a non-empty
 * string. That is not enough for these messages.
 *
 * The blast-radius counts are ICU plural messages. A malformed one — a missing
 * category, an unbalanced brace, a stray placeholder name — still resolves to a
 * perfectly non-empty string and only throws when it is FORMATTED, at render
 * time, on the screen where a family is deciding whether to destroy their data.
 * So these are actually formatted here, in both locales, at the counts where
 * the grammar differs.
 *
 * French is not a copy of English's rule: its `one` category covers 0 AND 1, so
 * "0 compte" is correct where English needs "0 accounts". Both are asserted.
 */

const COUNT_KEYS = [
  'blastTransactions',
  'blastMonths',
  'blastAccounts',
  'blastRecurring',
  'blastFunds',
  'blastReviews',
  'blastMembers',
] as const;

const locales = [
  { name: 'en', messages: en },
  { name: 'fr', messages: fr },
] as const;

describe('deleteAccount ICU messages format without throwing', () => {
  for (const { name, messages } of locales) {
    describe(name, () => {
      const t = createTranslator({ locale: name, messages, namespace: 'deleteAccount' });

      for (const key of COUNT_KEYS) {
        it(`${key} formats at 0, 1 and many`, () => {
          for (const count of [0, 1, 2, 40]) {
            const out = t(key, { count });
            expect(typeof out).toBe('string');
            expect(out.length).toBeGreaterThan(0);
            // The number must actually appear — a plural message that dropped
            // its # would format cleanly and silently lose the figure.
            expect(out).toContain(String(count));
            // Nothing unsubstituted left behind.
            expect(out).not.toContain('{');
          }
        });
      }

      it('singular and plural really differ where the language says they should', () => {
        // English: 1 vs 2 differ. French: 0 and 1 share the `one` category.
        expect(t('blastAccounts', { count: 1 })).not.toBe(t('blastAccounts', { count: 2 }));
      });

      it('French treats 0 as singular, English does not', () => {
        const zero = t('blastAccounts', { count: 0 });
        const one = t('blastAccounts', { count: 1 });
        // Compare the words, ignoring the numeral itself.
        const strip = (s: string) => s.replace(/[0-9]/g, '').trim();
        if (name === 'fr') {
          expect(strip(zero)).toBe(strip(one));
        } else {
          expect(strip(zero)).not.toBe(strip(one));
        }
      });

      it('the interpolated non-count messages substitute their placeholders', () => {
        const blast = t('blastTitle', { household: 'The Test Household' });
        expect(blast).toContain('The Test Household');
        expect(blast).not.toContain('{');

        const blocked = t('blockedPromoteBody', { names: 'Julia' });
        expect(blocked).toContain('Julia');
        expect(blocked).not.toContain('{');
      });

      it('the plain messages the deletion screen depends on are present and non-empty', () => {
        const keys = ['title', 'noUndo', 'typeYourEmail', 'typeHouseholdName',
                      'hatchAcknowledge', 'startSelfDelete', 'startHouseholdDelete',
                      'confirmSelfDelete', 'confirmHouseholdDelete', 'selfBody',
                      'soleMemberBody', 'allPendingBody', 'exportFirstTitle',
                      'exportFirstBody', 'exportAgain', 'blockedTitle',
                      'blockedNoPathBody', 'deleting', 'cancel', 'failed', 'loading'] as const;
        for (const key of keys) {
          expect(t(key).length).toBeGreaterThan(0);
        }
      });
    });
  }

  it('the tombstone label exists in both locales and is not the stored placeholder', () => {
    // The DB stores the literal 'Former member' as a neutral placeholder. The
    // UI must render THIS instead, or a French household sees English.
    const tEn = createTranslator({ locale: 'en', messages: en, namespace: 'household' });
    const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'household' });

    expect(tEn('formerName').length).toBeGreaterThan(0);
    expect(tFr('formerName').length).toBeGreaterThan(0);
    expect(tEn('formerBadge').length).toBeGreaterThan(0);
    expect(tFr('formerBadge').length).toBeGreaterThan(0);
    // If these matched, the French UI would be showing the raw DB placeholder.
    expect(tFr('formerName')).not.toBe(tEn('formerName'));
  });
});
