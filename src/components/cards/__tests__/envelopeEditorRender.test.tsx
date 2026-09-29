/**
 * The plan editor, rendered (react-dom/server, real messages). 2026-09-29.
 *
 * Asserts what the editor OPENS with, which is exactly what an untouched Save
 * writes:
 *   - the plan the decision view was showing (carried forward or its own),
 *     not the spend-only rows listed beside it;
 *   - when later months have plans of their own, the choice about them with
 *     NOTHING pre-selected, the count and the months named, and Save disabled
 *     until the household chooses.
 *
 * Only the first render is visible here (no clicks). next-intl throws on a
 * missing key, so both locales rendering proves the new keys resolve; the
 * French text is printed for a human to read.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import CardEnvelopeEditor from '../CardEnvelopeEditor';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

const MESSAGES = { en, fr } as const;
const noop = () => {};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function renderEditor(laterPlanMonths: string[], locale: 'en' | 'fr' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <CardEnvelopeEditor
        cardId="card-master"
        month="2026-10"
        totalGoal={900}
        envelopeItems={[
          { categoryId: 'cat-groceries', categoryName: 'Groceries & Pharmacy', monthlyAmount: 500, planned: true },
          { categoryId: 'cat-restaurants', categoryName: 'Restaurants', monthlyAmount: 150, planned: true },
          { categoryId: 'cat-shopping', categoryName: 'Shopping', monthlyAmount: 0, planned: false },
        ]}
        statementCloseDay={15}
        paymentDay={5}
        laterPlanMonths={laterPlanMonths}
        categories={[
          { id: 'cat-groceries', name: 'Groceries & Pharmacy' },
          { id: 'cat-restaurants', name: 'Restaurants' },
          { id: 'cat-shopping', name: 'Shopping' },
        ]}
        locale={locale}
        onSaved={noop}
        onCancel={noop}
      />
    </NextIntlClientProvider>
  );
}

// The Save button is the only one labelled with editor.save.
const saveButton = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

describe('CardEnvelopeEditor opens with the shown plan', () => {
  it('one editable row per planned category, with its amount; the spend-only category is only offered to add', () => {
    const html = renderEditor([]);
    // One "Remove" per editable plan row.
    expect(html.match(/>Remove</g)?.length).toBe(2);
    expect(html).toContain('value="500"');
    expect(html).toContain('value="150"');
    // Shopping is not a plan row — it appears only as an add-category option.
    expect(html).toMatch(/<option value="cat-shopping">Shopping<\/option>/);
    expect(html).not.toMatch(/<option value="cat-groceries">/);
  });

  it('no later plans: no question, and Save is enabled', () => {
    const html = renderEditor([]);
    expect(html).not.toContain('role="radiogroup"');
    const save = saveButton(html, 'Save envelope');
    expect(save).not.toBe('');
    expect(save).not.toMatch(/ disabled=""/);
  });
});

describe('CardEnvelopeEditor asks about later months\' own plans', () => {
  it('names the count and the months, pre-selects nothing, and disables Save until a choice is made', () => {
    const html = renderEditor(['2026-11', '2026-12']);
    const shown = text(html);
    expect(shown).toContain('2 later months (November 2026, December 2026) have their own plans');
    expect(shown).toContain('Replace all 2 with this plan');
    expect(shown).toContain('Keep their own plans');
    expect(html.match(/role="radio"/g)?.length).toBe(2);
    expect(html.match(/aria-checked="false"/g)?.length).toBe(2);
    expect(html).not.toContain('aria-checked="true"');
    expect(saveButton(html, 'Save envelope')).toMatch(/ disabled=""/);
  });

  it('one later month reads in the singular', () => {
    const shown = text(renderEditor(['2026-11']));
    expect(shown).toContain('1 later month (November 2026) has its own plan');
    expect(shown).toContain('Replace it with this plan');
  });

  it('fr: renders in French, with French month names', () => {
    const html = renderEditor(['2026-11', '2026-12'], 'fr');
    const shown = text(html);
    console.log(`\n--- FR later-plans question ---\n${shown.slice(shown.indexOf('Des mois'))}\n`);
    expect(shown).toContain('2 mois à venir (novembre 2026, décembre 2026) ont déjà leur propre plan');
    expect(shown).toContain('Remplacer les 2 par ce plan');
    expect(shown).toContain('Garder leur propre plan');
    expect(saveButton(html, "Enregistrer l&#x27;enveloppe")).toMatch(/ disabled=""/);
  });
});
