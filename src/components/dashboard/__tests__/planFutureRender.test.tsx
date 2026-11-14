/**
 * The Plan card for a future, a current and a past month, rendered through
 * react-dom/server against the REAL src/messages/*.json, in both locales
 * (2026-11-14). Asserts the rendered text, not the props: next-intl throws on
 * a key that does not resolve, and a figure that does not reach the screen
 * fails here.
 *
 * Figures: household 2be22642, May 2027, as the live plan chain computed
 * them on 2026-11-14 (read-only). The sum must add up on screen:
 *   1,410.01 + 11,115.00 − 7,123.33 − 1,489.52 − 4,550.00 = −637.84
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import SnapshotCard from '../SnapshotCard';
import type { DashboardSummary } from '../types';
import type { CardStatementHistory, PlanChainMonthPayload } from '@/lib/planChainHelpers';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

const MESSAGES = { en, fr } as const;
const NBSP = ' ';

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();

const SUMMARY: DashboardSummary = {
  totalIncome: 11115, totalExpenses: 7739.49, totalSavings: 1489.52, totalDebtPayments: 0,
  totalBorrowed: 0, totalWithdrawn: 0, netCashFlow: 1885.99, savingsByDestination: [],
} as unknown as DashboardSummary;

const card = (cardId: string, cardName: string, amount: number, budget: number) =>
  ({ cardId, cardName, basis: 'budget' as const, amount, budget, noData: false, inProgress: false });

const MAY_LINES = { income: 11115, bills: 7123.33, savings: 1489.52, debtPayments: 0, drawn: 0, leftAfterBillsAndSavings: 2502.15, cards: 4550 };

const MAY: PlanChainMonthPayload = {
  month: '2027-05', rangeStart: '2027-05-01', rangeEnd: '2027-05-31', isPartialMonth: false,
  startBalance: 1410.01, income: 11115, datedExpenses: 8612.85,
  cardCost: [card('c1', 'Costco Lineu', 1000, 1000), card('c2', 'Visa Avion', 2550, 2550), card('c3', 'Costco Julia', 1000, 1000)],
  cardCostTotal: 4550, balance: -637.84,
  breakdown: { status: 'ok', lines: MAY_LINES },
  extraPayments: [],
  why: { kind: 'extraPayments', items: [{ name: 'Mortgage / Hypothèque', occurrences: 3, usualOccurrences: 2, dates: ['2027-05-03', '2027-05-17', '2027-05-31'] }] },
  unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
};

const NOV: PlanChainMonthPayload = {
  ...MAY, month: '2026-11', isPartialMonth: true, startBalance: 7576.72, balance: 2021.03, why: null,
  cardCost: [{ cardId: 'c2', cardName: 'Visa Avion', basis: 'actual', amount: 5696.18, budget: 3700, noData: false, inProgress: false }],
};

const PATH = [
  { month: '2026-11', balance: 2021.03 }, { month: '2026-12', balance: 3731.41 },
  { month: '2027-01', balance: 3053.56 }, { month: '2027-05', balance: -637.84 },
];

const HISTORY: CardStatementHistory[] = [
  { cardId: 'c2', cardName: 'Visa Avion', count: 4, low: 4049.28, high: 5696.18, statements: [] },
];

function render(locale: 'en' | 'fr', month: string, planMonth: PlanChainMonthPayload | null) {
  return text(renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <SnapshotCard
        summary={SUMMARY} locale={locale} month={month}
        onPrevMonth={() => {}} onNextMonth={() => {}} isMaxMonth={false} isMinMonth={false}
        currentMonth="2026-11" isPastMonth={month < '2026-11'}
        carriedInAmount={16272.74} realCloseAmount={18158.73}
        planMonth={planMonth} isHorizonEnd={false}
        pathMonths={PATH} statementHistory={HISTORY}
      />
    </NextIntlClientProvider>
  ));
}

describe('Plan card — a future month shows one sum', () => {
  it('en: the sum, line by line, ending at the plan balance', () => {
    const out = render('en', '2027-05', MAY);
    console.log(`\n--- EN May 2027 ---\n${out}\n`);
    expect(out).toContain('Scheduled for May 2027');
    expect(out).toContain('Planned chequing balance');
    expect(out).toContain('If bills and card budgets land as planned');
    expect(out).toContain('Start of May 2027 (planned) $1,410.01');
    expect(out).toContain('+ Income scheduled $11,115.00');
    expect(out).toContain('− Bills from chequing $7,123.33');
    expect(out).toContain('− Savings transfers $1,489.52');
    expect(out).toContain('− Costco Lineu — your budget (statement not open yet) $1,000.00');
    expect(out).toContain('− Visa Avion — your budget (statement not open yet) $2,550.00');
    expect(out).toContain('− Costco Julia — your budget (statement not open yet) $1,000.00');
    expect(out).toContain('= End of May 2027 (planned) -$637.84');
    expect(out).toContain('May 2027 has 3 Mortgage / Hypothèque payments (May 3, 17, 31).');
    expect(out).toContain('Month-end balances (planned)');
    expect(out).toContain('Visa Avion: budget $2,550.00 · last 4 statements $4,049.28 – $5,696.18');
  });

  it('en: the snapshot and the real-balance lines are gone, and zero rows are not drawn', () => {
    const out = render('en', '2027-05', MAY);
    for (const gone of ['Did this month cover itself?', 'Actuals so far', 'Monthly surplus', 'Real balance at close',
      'Real balance carried in', "Cash you'll actually have", '$18,158.73', '$16,272.74', 'Debt payments', 'From savings / borrowed']) {
      expect(out).not.toContain(gone);
    }
  });

  it('fr: the same sum, written in French, with U+00A0 in every figure', () => {
    const out = render('fr', '2027-05', MAY);
    console.log(`\n--- FR mai 2027 ---\n${out}\n`);
    expect(out).toContain('Prévu pour mai 2027');
    expect(out).toContain('Solde prévu du compte chèques');
    expect(out).toContain('Si les factures et les budgets de cartes se réalisent comme prévu');
    expect(out).toContain(`Début mai 2027 (prévu) 1${NBSP}410,01${NBSP}$`);
    expect(out).toContain(`+ Revenus prévus 11${NBSP}115,00${NBSP}$`);
    expect(out).toContain(`− Factures payées du compte chèques 7${NBSP}123,33${NBSP}$`);
    expect(out).toContain(`− Virements vers l'épargne 1${NBSP}489,52${NBSP}$`);
    expect(out).toContain(`− Visa Avion — votre budget (relevé pas encore ouvert) 2${NBSP}550,00${NBSP}$`);
    expect(out).toContain(`= Fin mai 2027 (prévu) -637,84${NBSP}$`);
    expect(out).toContain(`Mai 2027 compte 3 paiements «${NBSP}Mortgage / Hypothèque${NBSP}» (3, 17 et 31 mai).`);
    expect(out).toContain(`Visa Avion : budget de 2${NBSP}550,00${NBSP}$ · 4 derniers relevés : de 4${NBSP}049,28${NBSP}$ à 5${NBSP}696,18${NBSP}$`);
    expect(out).not.toContain('Solde réel');
  });

  it('a debt payment and drawn cash get their own rows when not zero', () => {
    const withBoth: PlanChainMonthPayload = {
      ...MAY,
      breakdown: { status: 'ok', lines: { ...MAY_LINES, debtPayments: 250, drawn: 400 } },
    };
    const out = render('en', '2027-05', withBoth);
    expect(out).toContain('+ From savings / borrowed $400.00');
    expect(out).toContain('− Debt payments $250.00');
  });

  it('a breakdown the server could not build shows the message and NO line, NO end figure', () => {
    for (const locale of ['en', 'fr'] as const) {
      const out = render(locale, '2027-05', { ...MAY, breakdown: { status: 'error' } });
      expect(out).toContain(locale === 'en' ? "We couldn't build this month's breakdown." : "Nous n'avons pas pu établir le détail de ce mois.");
      expect(out).not.toMatch(/Start of|Début|Income scheduled|Revenus prévus|End of|Fin mai/);
      expect(out).not.toContain('1,410.01');
      expect(out).not.toContain('Hypothèque');
    }
  });

  it('every card basis has its own words', () => {
    const terms = [
      { ...card('a', 'A', 10, 10), basis: 'actual' as const, inProgress: true },
      { ...card('b', 'B', 20, 10), basis: 'actual' as const, inProgress: false },
      { ...card('c', 'C', 30, 10), basis: 'max' as const },
      { ...card('d', 'D', 0, 10), basis: 'posted' as const },
    ];
    const en = render('en', '2027-05', { ...MAY, cardCost: terms });
    expect(en).toContain('A — statement so far $10.00');
    expect(en).toContain('B — closed statement $20.00');
    expect(en).toContain('C — over budget, using actual $30.00');
    expect(en).toContain('D — already paid $0.00');
    const fr = render('fr', '2027-05', { ...MAY, cardCost: terms });
    expect(fr).toContain('A — relevé en cours');
    expect(fr).toContain('D — déjà payé');
  });
});

describe('Plan card — current and past months keep their layout', () => {
  it('current month: the snapshot and real lines stay; the path and statement check are added', () => {
    const out = render('en', '2026-11', NOV);
    console.log(`\n--- EN Nov 2026 (current) ---\n${out}\n`);
    expect(out).toContain('Did this month cover itself?');
    expect(out).toContain('Monthly surplus');
    expect(out).toContain('Real balance at close of November 2026: $18,158.73');
    expect(out).toContain("Cash you'll actually have");
    expect(out).toContain('Month-end balances (planned)');
    expect(out).toContain('Visa Avion: budget $3,700.00 · last 4 statements $4,049.28 – $5,696.18');
    expect(out).not.toContain('Scheduled for');
    expect(out).not.toContain('End of November');
  });

  it('past month: unchanged — no path, no statement check', () => {
    const out = render('en', '2026-09', null);
    expect(out).toContain('has already happened');
    expect(out).not.toContain('Month-end balances');
    expect(out).not.toContain('Card budgets vs real statements');
  });
});
