import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatCADLocale,
  formatPlanDates,
  planCardBasisKey,
  planPathGeometry,
  planPathMonthLabel,
  sentenceStart,
} from '@phare/core';
import type {
  HomePathPoint,
  HomePlanCard,
  HomePlanLines,
  HomeStatement,
  HomeWhy,
} from '../lib/homeLoader';
import { formatMonthLong } from '../lib/timelineView';
import { useI18n } from '../i18n';
import { theme } from '../theme';

// The Plan card's future-month parts (2026-11-14) — the web tile's
// PlanFutureParts, drawn with plain Views (no native module). Every figure is
// the server's plan chain; bar geometry, date lists and card wording come from
// @phare/core, the same functions the web uses.

const C = {
  label: '#CBD5E1',
  muted: '#94A3B8',
  operator: '#64748B',
  white: '#FFFFFF',
  negative: '#FCA5A5',
  card: '#C4B5FD',
  rule: 'rgba(148,163,184,0.35)',
  bar: '#2ABFBF',
  why: '#FCD34D',
} as const;

function SumRow({ op, label, value, color, emphasis = false, onPress, expanded, toggleLabel }: {
  op: string; label: string; value: string; color: string; emphasis?: boolean;
  /** Present only on the savings row, and only when it has destinations — as on the snapshot. */
  onPress?: () => void; expanded?: boolean; toggleLabel?: string;
}) {
  const content = (
    <>
      <Text style={styles.op}>{op}</Text>
      <Text style={[styles.sumLabel, emphasis && styles.sumLabelEmphasis]}>
        {label}
        {onPress ? (expanded ? '  ▴' : '  ▾') : ''}
      </Text>
      <Text style={[styles.sumValue, emphasis && styles.sumValueEmphasis, { color }]}>{value}</Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}. ${toggleLabel ?? ''}`}
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={styles.sumRow}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.sumRow, emphasis && styles.sumRowEmphasis]}>{content}</View>;
}

/**
 * The one sum. Rows in formula order; a zero debt-payment or drawn row is left
 * out. `lines: null` (the server could not build it) draws the message only.
 */
export function FutureSum({ month, isPartialMonth, startBalance, lines, balance, cards }: {
  month: string; isPartialMonth: boolean; startBalance: number; lines: HomePlanLines | null; balance: number; cards: HomePlanCard[];
}) {
  const { t, locale } = useI18n();
  const [savingsOpen, setSavingsOpen] = useState(false);
  const money = (n: number) => formatCADLocale(n, locale);
  const monthLabel = formatMonthLong(month, locale);

  if (lines === null) {
    return <Text accessibilityRole="alert" style={styles.error}>{t('home.plan.future.breakdownError')}</Text>;
  }

  // Literal keys, one per basis, so the i18n parity test sees each one.
  const cardLabel = (card: HomePlanCard) => {
    const key = planCardBasisKey(card.basis, card.inProgress);
    const values = { card: card.cardName };
    return key === 'cardBudget' ? t('home.plan.future.cardBudget', values)
      : key === 'cardSoFar' ? t('home.plan.future.cardSoFar', values)
      : key === 'cardClosed' ? t('home.plan.future.cardClosed', values)
      : key === 'cardMax' ? t('home.plan.future.cardMax', values)
      : t('home.plan.future.cardPosted', values);
  };

  return (
    <View>
      {/* The current month starts from today's balance; a later one from where the month before it ends. */}
      <SumRow
        op=""
        label={isPartialMonth ? t('home.plan.future.startToday') : t('home.plan.future.start', { month: monthLabel })}
        value={money(startBalance)}
        color={C.white}
      />
      <SumRow op="+" label={t('home.plan.future.income')} value={money(lines.income)} color={C.white} />
      {lines.drawn > 0 && <SumRow op="+" label={t('home.plan.future.drawn')} value={money(lines.drawn)} color={C.white} />}
      <SumRow op="−" label={t('home.plan.future.bills')} value={money(lines.bills)} color={C.white} />
      <SumRow
        op="−"
        label={t('home.plan.future.savings')}
        value={money(lines.savings)}
        color={C.white}
        onPress={lines.savingsLines.length > 0 ? () => setSavingsOpen((open) => !open) : undefined}
        expanded={savingsOpen}
        toggleLabel={savingsOpen ? t('home.snapshot.hideBreakdown') : t('home.snapshot.showBreakdown')}
      />
      {savingsOpen && lines.savingsLines.length > 0 && (
        <View style={styles.savingsLines}>
          {lines.savingsLines.map((line) => (
            <View key={line.key} style={styles.savingsLine}>
              <Text style={styles.savingsName} numberOfLines={1}>{line.name ?? t('home.snapshot.savingsOther')}</Text>
              <Text style={styles.savingsAmount}>{money(line.amount)}</Text>
            </View>
          ))}
          {lines.savingsLines.some((line) => line.name === null) && (
            <Text style={styles.small}>{t('home.snapshot.savingsOtherHint')}</Text>
          )}
        </View>
      )}
      {lines.debtPayments > 0 && (
        <SumRow op="−" label={t('home.plan.future.debtPayments')} value={money(lines.debtPayments)} color={C.white} />
      )}
      {cards.map((card) => (
        <SumRow key={card.cardId} op="−" label={cardLabel(card)} value={money(card.amount)} color={C.card} />
      ))}
      <SumRow
        op="="
        label={t('home.plan.future.end', { month: monthLabel })}
        value={money(balance)}
        color={balance >= 0 ? C.white : C.negative}
        emphasis
      />
    </View>
  );
}

/** The server's reason a month dips, worded. */
export function WhyLines({ month, why }: { month: string; why: HomeWhy | null }) {
  const { t, locale } = useI18n();
  if (!why) return null;
  const money = (n: number) => formatCADLocale(n, locale);
  const monthLabel = formatMonthLong(month, locale);
  const lines =
    why.kind === 'extraPayments'
      ? why.items.map((item) => t('home.plan.why.extraPayment', {
          month: sentenceStart(monthLabel, locale),
          count: String(item.occurrences),
          name: item.name,
          dates: formatPlanDates(item.dates, locale),
        }))
      : why.kind === 'cardsOverLeft'
        ? [t('home.plan.why.cardsOverLeft', { cards: money(why.cards), left: money(why.left) })]
        : why.kind === 'startsBelowZero'
          ? [why.isPartialMonth
              ? t('home.plan.why.todayBelowZero', { amount: money(why.startBalance) })
              : t('home.plan.why.startsBelowZero', { month: sentenceStart(monthLabel, locale), amount: money(why.startBalance) })]
          : [t('home.plan.why.moreOutThanIn', { month: monthLabel, amount: money(why.amount) })];
  return (
    <View style={styles.gapXs}>
      {lines.map((line) => <Text key={line} style={styles.why}>{line}</Text>)}
    </View>
  );
}

const PATH_HEIGHT = 64;

/**
 * Month-end balances as bars around a zero line, the viewed month lit — the
 * web's bars, from the same planPathGeometry. Read out as one list.
 */
export function PlanPath({ points, selectedMonth }: { points: HomePathPoint[]; selectedMonth: string }) {
  const { t, locale } = useI18n();
  if (points.length < 2) return null;
  const { zero, bars } = planPathGeometry(points.map((p) => p.balance));
  const spoken = points
    .map((p) => t('home.plan.path.item', { month: formatMonthLong(p.month, locale), amount: formatCADLocale(p.balance, locale) }))
    .join('; ');
  return (
    <View accessible accessibilityLabel={`${t('home.plan.path.title')}. ${spoken}`} style={styles.gapXs}>
      <Text style={styles.small}>{t('home.plan.path.title')}</Text>
      <View style={styles.pathPlot}>
        {bars.map((bar, i) => {
          const selected = points[i].month === selectedMonth;
          return (
            <View key={points[i].month} style={styles.pathSlot}>
              <View
                style={[
                  styles.pathBar,
                  {
                    top: bar.top * PATH_HEIGHT,
                    height: bar.height > 0 ? Math.max(bar.height * PATH_HEIGHT, 1) : 0,
                    backgroundColor: bar.negative ? C.negative : C.bar,
                    opacity: selected ? 1 : 0.45,
                  },
                ]}
              />
            </View>
          );
        })}
        <View style={[styles.zeroLine, { top: zero * PATH_HEIGHT }]} />
      </View>
      <View style={styles.pathLabels}>
        {points.map((p) => (
          <Text key={p.month} style={[styles.pathLabel, p.month === selectedMonth && { color: C.white }]}>
            {planPathMonthLabel(p.month, locale)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Each card's budget for this month beside the server's average of its closed statements, and how many. */
export function StatementCheck({ statements }: { statements: HomeStatement[] }) {
  const { t, locale } = useI18n();
  if (statements.length === 0) return null;
  const money = (n: number) => formatCADLocale(n, locale);
  return (
    <View style={styles.gapXs}>
      <Text style={styles.small}>{t('home.plan.statements.title')}</Text>
      {statements.map((s) => {
        const values = { card: s.cardName, count: String(s.count), average: money(s.average) };
        return (
          <Text key={s.cardId} style={styles.statement}>
            {s.budget === null
              ? t('home.plan.statements.rowNoBudget', values)
              : t('home.plan.statements.row', { ...values, budget: money(s.budget) })}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sumRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm, paddingVertical: 2 },
  sumRowEmphasis: { borderTopWidth: 1, borderTopColor: C.rule, paddingTop: theme.space.sm, marginTop: theme.space.xs },
  op: { width: 12, textAlign: 'center', fontSize: 14, fontWeight: '600', color: C.operator },
  sumLabel: { flex: 1, fontSize: 13, lineHeight: 18, color: C.label },
  sumLabelEmphasis: { fontSize: 14, fontWeight: '600', color: C.white },
  sumValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sumValueEmphasis: { fontSize: 20 },
  error: { fontSize: 14, fontWeight: '600', color: C.negative },
  why: { fontSize: 14, lineHeight: 20, color: C.why },
  small: { fontSize: 12, lineHeight: 17, color: C.muted },
  gapXs: { gap: theme.space.xs },
  pathPlot: { height: PATH_HEIGHT, flexDirection: 'row' },
  pathSlot: { flex: 1, alignItems: 'center' },
  pathBar: { position: 'absolute', width: 14, borderRadius: 2 },
  zeroLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.muted },
  pathLabels: { flexDirection: 'row' },
  pathLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted },
  statement: { fontSize: 12, lineHeight: 17, color: C.card },
  savingsLines: { paddingLeft: theme.space.lg, gap: 2, paddingBottom: theme.space.xs },
  savingsLine: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.sm },
  savingsName: { flex: 1, fontSize: 12, color: C.muted },
  savingsAmount: { fontSize: 12, color: C.label, fontVariant: ['tabular-nums'] },
});
