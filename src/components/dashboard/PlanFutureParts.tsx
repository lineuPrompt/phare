'use client';

import { useTranslations } from 'next-intl';
import { formatPlanDates, planCardBasisKey, planPathGeometry, planPathMonthLabel, sentenceStart } from '@phare/core';
import type {
  CardCostTerm,
  CardStatementHistory,
  PlanChainMonthPayload,
} from '@/lib/planChainHelpers';
import { formatCurrency } from './types';

// The future-month parts of the Plan card (2026-11-14). Every figure here is
// the plan chain's, from /api/timeline — these components only lay it out.
// The app's Home draws the same parts from the same payload.

// On-dark palette, the Plan card's own (see PlanChainTile).
const C = {
  label: '#CBD5E1',
  muted: '#94A3B8',
  operator: '#64748B',
  white: '#FFFFFF',
  negative: '#FCA5A5',
  card: '#C4B5FD',
  rule: 'rgba(148,163,184,0.35)',
  bar: '#2ABFBF',
};

function Row({ op, label, amount, locale, color, emphasis = false }: {
  op: string; label: string; amount: number; locale: string; color: string; emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 ${emphasis ? 'pt-2 mt-1' : 'py-0.5'}`}
      style={emphasis ? { borderTop: `1px solid ${C.rule}` } : undefined}
    >
      <span aria-hidden="true" className="w-3 shrink-0 text-center text-sm font-semibold" style={{ color: C.operator }}>{op}</span>
      <span className={`flex-1 min-w-0 ${emphasis ? 'text-sm font-semibold' : 'text-sm'}`} style={{ color: emphasis ? C.white : C.label }}>
        {label}
      </span>
      <span className={`shrink-0 tabular-nums font-bold ${emphasis ? 'text-xl' : 'text-sm'}`} style={{ color }}>
        {formatCurrency(amount, locale)}
      </span>
    </div>
  );
}

/**
 * The one sum for a future month. Rows in formula order; a zero debt-payment
 * or drawn row is left out (the rest still add up exactly without it). A
 * breakdown that did not add up on the server is NOT drawn — no partial line,
 * no end figure — only the message.
 */
export function FuturePlanSum({ planMonth, monthLabel, locale }: {
  planMonth: PlanChainMonthPayload; monthLabel: string; locale: string;
}) {
  const t = useTranslations('dashboard.plan.future');
  if (planMonth.breakdown.status !== 'ok') {
    return (
      <p role="alert" className="text-sm font-medium mt-2" style={{ color: C.negative }}>
        {t('breakdownError')}
      </p>
    );
  }
  const l = planMonth.breakdown.lines;
  const end = planMonth.balance;
  return (
    <div className="mt-2">
      <Row op="" label={t('start', { month: monthLabel })} amount={planMonth.startBalance} locale={locale} color={C.white} />
      <Row op="+" label={t('income')} amount={l.income} locale={locale} color={C.white} />
      {l.drawn > 0 && <Row op="+" label={t('drawn')} amount={l.drawn} locale={locale} color={C.white} />}
      <Row op="−" label={t('bills')} amount={l.bills} locale={locale} color={C.white} />
      <Row op="−" label={t('savings')} amount={l.savings} locale={locale} color={C.white} />
      {l.debtPayments > 0 && <Row op="−" label={t('debtPayments')} amount={l.debtPayments} locale={locale} color={C.white} />}
      {planMonth.cardCost.map((c) => (
        <Row
          key={c.cardId}
          op="−"
          label={t(planCardBasisKey(c.basis, c.inProgress), { card: c.cardName })}
          amount={c.amount}
          locale={locale}
          color={C.card}
        />
      ))}
      <Row
        op="="
        label={t('end', { month: monthLabel })}
        amount={end}
        locale={locale}
        color={end >= 0 ? C.white : C.negative}
        emphasis
      />
    </div>
  );
}

/** The code-chosen reason a month dips (explainPlanPath). Nothing when it has none. */
export function PlanWhyLine({ planMonth, monthLabel, locale }: {
  planMonth: PlanChainMonthPayload; monthLabel: string; locale: string;
}) {
  const t = useTranslations('dashboard.plan.why');
  const why = planMonth.why;
  // A month whose breakdown failed shows only the failure message — no
  // explanation of a sum the household cannot see.
  if (!why || planMonth.breakdown.status !== 'ok') return null;
  const money = (n: number) => formatCurrency(n, locale);
  const lines: string[] =
    why.kind === 'extraPayments'
      ? why.items.map((item) => t('extraPayment', {
          month: sentenceStart(monthLabel, locale),
          count: item.occurrences,
          name: item.name,
          dates: formatPlanDates(item.dates, locale),
        }))
      : why.kind === 'cardsOverLeft'
        ? [t('cardsOverLeft', { cards: money(why.cards), left: money(why.left) })]
        : why.kind === 'startsBelowZero'
          ? [why.isPartialMonth
              ? t('todayBelowZero', { amount: money(why.startBalance) })
              : t('startsBelowZero', { month: sentenceStart(monthLabel, locale), amount: money(why.startBalance) })]
          : [t('moreOutThanIn', { month: monthLabel, amount: money(why.amount) })];
  return (
    <div className="mt-3 space-y-1">
      {lines.map((line) => (
        <p key={line} className="text-sm" style={{ color: '#FCD34D' }}>{line}</p>
      ))}
    </div>
  );
}

/**
 * Month-end balances as bars around a zero line, the viewed month lit. Bar
 * geometry is @phare/core's planPathGeometry — the app draws the same bars.
 * The figures are also listed for screen readers.
 */
export function PlanPathChart({ months, selectedMonth, locale }: {
  months: { month: string; balance: number }[]; selectedMonth: string; locale: string;
}) {
  const t = useTranslations('dashboard.plan.path');
  if (months.length < 2) return null;
  const { zero, bars } = planPathGeometry(months.map((m) => m.balance));
  const H = 64;
  const slot = 24;
  const barW = 14;
  const W = months.length * slot;
  const monthName = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' });
  };
  return (
    <div className="mt-4">
      <p className="text-xs font-medium mb-1" style={{ color: C.muted }}>{t('title')}</p>
      <svg viewBox={`0 0 ${W} ${H + 14}`} width="100%" height={H + 14} preserveAspectRatio="none" aria-hidden="true">
        {bars.map((b, i) => {
          const selected = months[i].month === selectedMonth;
          return (
            <rect
              key={months[i].month}
              x={i * slot + (slot - barW) / 2}
              y={b.top * H}
              width={barW}
              height={Math.max(b.height * H, b.height > 0 ? 1 : 0)}
              rx={2}
              fill={b.negative ? C.negative : C.bar}
              opacity={selected ? 1 : 0.45}
            />
          );
        })}
        <line x1={0} x2={W} y1={zero * H} y2={zero * H} stroke={C.muted} strokeWidth={1} />
        {months.map((m, i) => (
          <text
            key={m.month}
            x={i * slot + slot / 2}
            y={H + 11}
            textAnchor="middle"
            fontSize={9}
            fill={m.month === selectedMonth ? C.white : C.muted}
          >
            {planPathMonthLabel(m.month, locale)}
          </text>
        ))}
      </svg>
      <ul className="sr-only">
        {months.map((m) => (
          <li key={m.month}>{t('item', { month: monthName(m.month), amount: formatCurrency(m.balance, locale) })}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Each card's budget for this month beside its real closed statements (the
 * Cards page's own totals): the low, the high, and how many. Real
 * statements, never an average. Hidden for a card with fewer than 2 — the
 * server already leaves those out.
 */
export function StatementCheck({ history, cardCost, locale }: {
  history: CardStatementHistory[]; cardCost: CardCostTerm[]; locale: string;
}) {
  const t = useTranslations('dashboard.plan.statements');
  if (history.length === 0) return null;
  const budgetOf = new Map(cardCost.map((c) => [c.cardId, c.budget]));
  return (
    <div className="mt-4">
      <p className="text-xs font-medium mb-1" style={{ color: C.muted }}>{t('title')}</p>
      <ul className="space-y-1">
        {history.map((h) => {
          const budget = budgetOf.get(h.cardId) ?? null;
          const values = {
            card: h.cardName,
            count: h.count,
            low: formatCurrency(h.low, locale),
            high: formatCurrency(h.high, locale),
          };
          return (
            <li key={h.cardId} className="text-xs" style={{ color: C.card }}>
              {budget === null
                ? t('rowNoBudget', values)
                : t('row', { ...values, budget: formatCurrency(budget, locale) })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
