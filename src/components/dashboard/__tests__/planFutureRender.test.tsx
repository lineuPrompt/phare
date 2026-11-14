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
import { SavingsLines } from '../PlanFutureParts';
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

// May 2027's real savings transfers for 2be22642: 464 + 425.52 + 350 + 250 = 1,489.52.
const MAY_SAVINGS = [
  { accountId: 'resp', name: 'RESP (CTS Savings)', amount: 464 },
  { accountId: 'sf', name: 'Sinking funds', amount: 425.52 },
  { accountId: 'rrsp', name: 'Lineu -RRSP', amount: 350 },
  { accountId: 'fv', name: 'Ferias e Viagens', amount: 250 },
];
const MAY_LINES = { income: 11115, bills: 7123.33, savings: 1489.52, savingsByDestination: MAY_SAVINGS, debtPayments: 0, drawn: 0, leftAfterBillsAndSavings: 2502.15, cards: 4550 };

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

// 2be22642's November 2026 as the live chain computed it on the 14th: today's
// balance plus the rest of the month — 7,576.72 + 5,935.27 − 5,030.78 − 764.00
// − 5,696.18 = 2,021.03. (The savings destination below is a fixture name.)
const NOV: PlanChainMonthPayload = {
  ...MAY, month: '2026-11', isPartialMonth: true, startBalance: 7576.72, balance: 2021.03, why: null,
  breakdown: { status: 'ok', lines: {
    income: 5935.27, bills: 5030.78, savings: 764, debtPayments: 0, drawn: 0, leftAfterBillsAndSavings: 140.49, cards: 5696.18,
    savingsByDestination: [{ accountId: 'resp', name: 'RESP (CTS Savings)', amount: 764 }],
  } },
  cardCost: [{ cardId: 'c2', cardName: 'Visa Avion', basis: 'actual', amount: 5696.18, budget: 3700, noData: false, inProgress: false }],
};

const PATH = [
  { month: '2026-11', balance: 2021.03 }, { month: '2026-12', balance: 3731.41 },
  { month: '2027-01', balance: 3053.56 }, { month: '2027-05', balance: -637.84 },
];

const HISTORY: CardStatementHistory[] = [
  { cardId: 'c2', cardName: 'Visa Avion', count: 4, average: 4866.31, statements: [] },
];

function render(locale: 'en' | 'fr', month: string, planMonth: PlanChainMonthPayload | null) {
  return text(renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
      <SnapshotCard
        summary={SUMMARY} locale={locale} month={month}
        onPrevMonth={() => {}} onNextMonth={() => {}} isMaxMonth={false} isMinMonth={false}
        currentMonth="2026-11" isPastMonth={month < '2026-11'}
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
    expect(out).toContain('− Savings transfers ▾ Show breakdown $1,489.52');
    expect(out).toContain('− Costco Lineu — your budget (statement not open yet) $1,000.00');
    expect(out).toContain('− Visa Avion — your budget (statement not open yet) $2,550.00');
    expect(out).toContain('− Costco Julia — your budget (statement not open yet) $1,000.00');
    expect(out).toContain('= End of May 2027 (planned) -$637.84');
    expect(out).toContain('May 2027 has 3 Mortgage / Hypothèque payments (May 3, 17, 31).');
    expect(out).toContain('Month-end balances (planned)');
    expect(out).toContain('Visa Avion: budget $2,550.00 · average of last 4 statements $4,866.31');
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
    expect(out).toContain(`− Virements vers l'épargne ▾ Voir le détail 1${NBSP}489,52${NBSP}$`);
    expect(out).toContain(`− Visa Avion — votre budget (relevé pas encore ouvert) 2${NBSP}550,00${NBSP}$`);
    expect(out).toContain(`= Fin mai 2027 (prévu) -637,84${NBSP}$`);
    expect(out).toContain(`Mai 2027 compte 3 paiements «${NBSP}Mortgage / Hypothèque${NBSP}» (3, 17 et 31 mai).`);
    expect(out).toContain(`Visa Avion : budget de 2${NBSP}550,00${NBSP}$ · moyenne des 4 derniers relevés : 4${NBSP}866,31${NBSP}$`);
    expect(out).not.toContain('Solde réel');
  });

  it('the savings row is a toggle, closed, as on the snapshot', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={MESSAGES.en} timeZone="America/Toronto">
        <SnapshotCard
          summary={SUMMARY} locale="en" month="2027-05"
          onPrevMonth={() => {}} onNextMonth={() => {}} isMaxMonth={false} isMinMonth={false}
          currentMonth="2026-11" isPastMonth={false}
          planMonth={MAY} isHorizonEnd={false} pathMonths={PATH} statementHistory={HISTORY}
        />
      </NextIntlClientProvider>
    );
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Savings transfers(?:(?!<\/button>).)*Show breakdown/);
    // Closed: no destination is drawn yet.
    expect(text(html)).not.toContain('Sinking funds');
  });

  it('opened, the savings row lists each destination, adding up to the line, in both languages', () => {
    const lines = [...MAY_SAVINGS, { accountId: null, name: null, amount: 10 }];
    for (const locale of ['en', 'fr'] as const) {
      const out = text(renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Toronto">
          <SavingsLines lines={lines} locale={locale} />
        </NextIntlClientProvider>
      ));
      if (locale === 'en') {
        expect(out).toContain('RESP (CTS Savings) $464.00');
        expect(out).toContain('Sinking funds $425.52');
        expect(out).toContain('Other $10.00');
        expect(out).toContain('Contributions whose destination account no longer exists.');
      } else {
        expect(out).toContain(`Sinking funds 425,52${NBSP}$`);
        expect(out).toContain(`Autre 10,00${NBSP}$`);
      }
    }
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

describe('Plan card — the current month takes the same sum; past months are unchanged', () => {
  it('current month: the actuals snapshot stays; the Plan card is the sum, from today\'s balance', () => {
    const out = render('en', '2026-11', NOV);
    console.log(`\n--- EN Nov 2026 (current) ---\n${out}\n`);
    // This month's actuals, with their expandable savings row, stay.
    expect(out).toContain('Did this month cover itself?');
    expect(out).toContain('Monthly surplus');
    // The Plan card: the same sum as a future month, starting from today.
    expect(out).toContain('Planned chequing balance');
    expect(out).toContain("If the rest of November 2026's bills and card budgets land as planned");
    expect(out).toContain('Balance today $7,576.72');
    expect(out).toContain('+ Income scheduled $11,115.00'.replace('11,115.00', '5,935.27'));
    expect(out).toContain('− Bills from chequing $5,030.78');
    expect(out).toContain('− Savings transfers ▾ Show breakdown $764.00');
    expect(out).toContain('− Visa Avion — closed statement $5,696.18');
    expect(out).toContain('= End of November 2026 (planned) $2,021.03');
    expect(out).toContain('Month-end balances (planned)');
    expect(out).toContain('Visa Avion: budget $3,700.00 · average of last 4 statements $4,866.31');
    // Gone: the real-balance lines and the old single figure.
    for (const gone of ['Real balance at close', 'Real balance carried in', "Cash you'll actually have", 'Scheduled for', 'Start of November']) {
      expect(out).not.toContain(gone);
    }
  });

  it('fr: current month starts from « Solde d\'aujourd\'hui »', () => {
    const out = render('fr', '2026-11', NOV);
    expect(out).toContain(`Solde d'aujourd'hui 7${NBSP}576,72${NBSP}$`);
    expect(out).toContain('Si les factures et les budgets de cartes du reste de novembre 2026 se réalisent comme prévu');
    expect(out).toContain(`= Fin novembre 2026 (prévu) 2${NBSP}021,03${NBSP}$`);
    expect(out).not.toContain('Solde réel');
  });

  it('past month: unchanged — no path, no statement check', () => {
    const out = render('en', '2026-09', null);
    expect(out).toContain('has already happened');
    expect(out).not.toContain('Month-end balances');
    expect(out).not.toContain('Card budgets vs real statements');
  });
});
