/**
 * The plan editor, rendered (react-dom/server, real messages). 2026-09-29.
 *
 * Asserts what the editor OPENS with: the plan the decision view was showing
 * — carried forward or its own — and not the spend-only rows the decision
 * view lists beside it. Pressing Save then writes that plan back unchanged.
 *
 * Only the first render is visible here (no clicks), which is exactly the
 * state that decides what an untouched Save writes.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import CardEnvelopeEditor from '../CardEnvelopeEditor';
import en from '@/messages/en.json';

const noop = () => {};

function renderEditor() {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="America/Toronto">
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
        categories={[
          { id: 'cat-groceries', name: 'Groceries & Pharmacy' },
          { id: 'cat-restaurants', name: 'Restaurants' },
          { id: 'cat-shopping', name: 'Shopping' },
        ]}
        locale="en"
        onSaved={noop}
        onCancel={noop}
      />
    </NextIntlClientProvider>
  );
}

describe('CardEnvelopeEditor opens with the shown plan', () => {
  it('one editable row per planned category, with its amount; the spend-only category is only offered to add', () => {
    const html = renderEditor();
    // One "Remove" per editable plan row.
    expect(html.match(/>Remove</g)?.length).toBe(2);
    expect(html).toContain('value="500"');
    expect(html).toContain('value="150"');
    // Shopping is not a plan row — it appears only as an add-category option.
    expect(html).toMatch(/<option value="cat-shopping">Shopping<\/option>/);
    expect(html).not.toMatch(/<option value="cat-groceries">/);
  });
});
