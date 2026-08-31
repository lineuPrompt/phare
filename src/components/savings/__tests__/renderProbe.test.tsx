/**
 * NOT an assertion test — a RENDER PROBE, kept because the alternative here
 * failed us before: a button once shipped behind a wall of green tests
 * without rendering at all. This actually runs the components through
 * react-dom/server against the REAL src/messages/*.json, in BOTH locales,
 * and prints the resulting HTML so a human (or the agent writing the
 * handoff) reads the real strings rather than a mock's echo.
 *
 * next-intl throws on a missing key, so a key that doesn't resolve fails
 * this file loudly instead of rendering an empty span. That is the property
 * being checked: every t() call in the new contributionEditor namespace
 * resolves in en AND fr.
 *
 * It cannot replace looking at the live page — it renders components, not
 * the authenticated /savings route. See the handoff's verification section.
 *
 * Run: pnpm vitest run src/components/savings/__tests__/renderProbe.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import ContributionEditor from '../ContributionEditor';
import ContributionDriftNotice from '../ContributionDriftNotice';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

const MESSAGES = { en, fr } as const;

// Strips tags so the printed block reads as the copy a household would see.
const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function render(locale: 'en' | 'fr', node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      {node}
    </NextIntlClientProvider>
  );
}

// The live shape: household 2be22642's Ferias e Viagens goal — a $25
// biweekly rule with 24 upcoming rows a household hand-edited to $125.
const DRIFT = { count: 24, amounts: [125], ruleAmount: 25 };

describe('contribution editor + drift notice render in both locales', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`${locale}: drift notice`, () => {
      const html = render(locale, <ContributionDriftNotice drift={DRIFT} locale={locale} />);
      console.log(`\n--- ${locale.toUpperCase()} drift notice ---\n${text(html)}\n`);
      expect(html).not.toMatch(/contributionEditor\./); // an unresolved key leaks its path
      expect(text(html).length).toBeGreaterThan(80);
    });

    it(`${locale}: editor, biweekly (date anchor)`, () => {
      const html = render(locale,
        <ContributionEditor
          recurringItemId="rule-1" currentAmount={25} cadence="biweekly"
          anchorDate="2026-08-12" secondDay={null} tombstonesAfterBoundary={0}
          today="2026-08-31" onSaved={() => {}} onCancel={() => {}}
        />
      );
      console.log(`\n--- ${locale.toUpperCase()} editor (biweekly) ---\n${text(html)}\n`);
      expect(html).not.toMatch(/contributionEditor\./);
      expect(html).toContain('value="25"');
      expect(html).toContain('value="2026-08-12"'); // date anchor, not day-of-month
    });

    it(`${locale}: editor, monthly (day-of-month anchor + semimonthly field)`, () => {
      const html = render(locale,
        <ContributionEditor
          recurringItemId="rule-2" currentAmount={628.02} cadence="semimonthly"
          anchorDate="2026-08-30" secondDay={15} tombstonesAfterBoundary={3}
          today="2026-08-31" onSaved={() => {}} onCancel={() => {}}
        />
      );
      console.log(`\n--- ${locale.toUpperCase()} editor (semimonthly) ---\n${text(html)}\n`);
      expect(html).not.toMatch(/contributionEditor\./);
      expect(html).toContain('value="30"');  // day-of-month read off the anchor
      expect(html).toContain('value="15"');  // second day
    });
  }

  // The plural branch is the one most likely to be wrong in only one locale.
  it('singular drift copy resolves in both locales', () => {
    for (const locale of ['en', 'fr'] as const) {
      const html = render(locale,
        <ContributionDriftNotice drift={{ count: 1, amounts: [125], ruleAmount: 25 }} locale={locale} />
      );
      console.log(`\n--- ${locale.toUpperCase()} drift notice (count=1) ---\n${text(html)}\n`);
      expect(html).not.toMatch(/contributionEditor\./);
    }
  });

  // Used by GoalsSection rather than by either component above, so it would
  // otherwise go unrendered here.
  it('projectionHidden + editCta resolve in both locales', () => {
    for (const locale of ['en', 'fr'] as const) {
      const m = MESSAGES[locale].contributionEditor as Record<string, string>;
      console.log(`${locale}: editCta            = ${JSON.stringify(m.editCta)}`);
      console.log(`${locale}: projectionHidden   = ${JSON.stringify(m.projectionHidden)}`);
      expect(m.editCta).toBeTruthy();
      expect(m.projectionHidden).toBeTruthy();
    }
  });
});
