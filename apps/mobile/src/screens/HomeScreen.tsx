import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCADLocale } from '@phare/core';
import { apiGet, messageKeyFor } from '../lib/api';
import { onEntrySaved } from '../lib/entryEvents';
import AddEntryButton from '../components/AddEntryButton';
import { loadHome, type CardBasis, type HomeLoad, type HomePlan, type HomeSnapshot } from '../lib/homeLoader';
import { formatMonthLong } from '../lib/timelineView';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Home: the web dashboard's snapshot and Plan card, for the current month.
 * Read-only.
 *
 * Differences from the web card (SnapshotCard / PlanChainTile), on purpose:
 *   - current month only. No month navigation, so no past-month or
 *     end-of-horizon states, and the projection horizon never comes up.
 *   - no links. The web card links to Timeline and to Recurring; here the
 *     Timeline is a tab away and dates are set on the web.
 *
 * Every figure is the server's (see homeLoader.ts).
 */

type Outcome = { load: HomeLoad } | { errorKey: string };

// The Plan card's own ground and on-dark text, as on the web tile.
const PLAN = {
  ground: '#0F2044',
  badgeGround: 'rgba(42,191,191,0.15)',
  label: '#94A3B8',
  secondary: '#64748B',
  figure: '#FFFFFF',
  negative: '#FCA5A5',
  card: '#C4B5FD',
  notice: '#FCD34D',
} as const;

function Row({
  operator,
  label,
  value,
  color,
  emphasis = false,
  onPress,
  expanded,
  toggleLabel,
}: {
  operator: string;
  label: string;
  value: string;
  color: string;
  emphasis?: boolean;
  /** Present only on the savings row, and only when there is a breakdown. */
  onPress?: () => void;
  expanded?: boolean;
  toggleLabel?: string;
}) {
  const content = (
    <>
      <Text style={styles.operator}>{operator}</Text>
      <Text style={[styles.rowLabel, emphasis && styles.rowLabelEmphasis]} numberOfLines={1}>
        {label}
        {onPress ? (expanded ? '  ▴' : '  ▾') : ''}
      </Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueEmphasis, { color }]}>{value}</Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}. ${toggleLabel ?? ''}`}
        accessibilityState={{ expanded }}
        onPress={onPress}
        style={styles.row}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.row, emphasis && styles.rowEmphasis]}>{content}</View>;
}

function SnapshotCard({ snapshot }: { snapshot: HomeSnapshot }) {
  const { t, locale } = useI18n();
  const [savingsOpen, setSavingsOpen] = useState(false);
  const money = (value: number) => formatCADLocale(value, locale);

  const surplus = snapshot.netCashFlow >= 0;
  const hasBreakdown = snapshot.savingsLines.length > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('home.snapshot.title')}</Text>

      {snapshot.awaitingDates && <Text style={styles.notice}>{t('home.awaitingDates')}</Text>}

      <View>
        <Text style={styles.question}>{t('home.snapshot.question')}</Text>
        <Text style={styles.caption}>{t('home.snapshot.actualsToDate')}</Text>
      </View>

      <View style={styles.subtraction}>
        <Row operator="" label={t('home.snapshot.income')} value={money(snapshot.income)} color={theme.color.positive} />
        <Row operator="−" label={t('home.snapshot.expenses')} value={money(snapshot.expenses)} color={theme.color.danger} />
        <Row
          operator="−"
          label={t('home.snapshot.savings')}
          value={money(snapshot.savings)}
          color={SAVINGS_COLOR}
          onPress={hasBreakdown ? () => setSavingsOpen((open) => !open) : undefined}
          expanded={savingsOpen}
          toggleLabel={savingsOpen ? t('home.snapshot.hideBreakdown') : t('home.snapshot.showBreakdown')}
        />
        {savingsOpen && hasBreakdown && (
          <View style={styles.breakdown}>
            {snapshot.savingsLines.map((line) => (
              <View key={line.key} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel} numberOfLines={1}>
                  {line.name ?? t('home.snapshot.savingsOther')}
                </Text>
                <Text style={styles.breakdownValue}>{money(line.amount)}</Text>
              </View>
            ))}
            {snapshot.savingsLines.some((line) => line.name === null) && (
              <Text style={styles.caption}>{t('home.snapshot.savingsOtherHint')}</Text>
            )}
          </View>
        )}
        {snapshot.debtPayments > 0 && (
          <Row
            operator="−"
            label={t('home.snapshot.debtPayments')}
            value={money(snapshot.debtPayments)}
            color={DEBT_COLOR}
          />
        )}
        <Row
          operator="="
          label={surplus ? t('home.snapshot.surplus') : t('home.snapshot.deficit')}
          value={money(snapshot.netCashFlow)}
          color={surplus ? theme.color.positive : theme.color.danger}
          emphasis
        />
      </View>

      {snapshot.borrowed > 0 && (
        <View style={styles.borrowedBox}>
          <Text style={styles.borrowedText}>
            {t('home.snapshot.borrowedNote', { amount: money(snapshot.borrowed) })}
          </Text>
        </View>
      )}

      <Text style={styles.caption}>{t('home.snapshot.monthOnlyNote')}</Text>
    </View>
  );
}

function PlanCard({ plan, month, borrowed }: { plan: HomePlan; month: string; borrowed: number }) {
  const { t, locale } = useI18n();
  const money = (value: number) => formatCADLocale(value, locale);
  const monthLabel = formatMonthLong(month, locale);

  if (plan.kind === 'hidden') return null;

  if (plan.kind === 'noAnchor') {
    return (
      <View style={styles.planCard}>
        <Text style={styles.badge}>{t('home.plan.badge')}</Text>
        <Text style={styles.planLabel}>{t('home.noAnchor')}</Text>
      </View>
    );
  }

  // Literal keys, one per basis, so the i18n parity test can see each one.
  const cardLine = (basis: CardBasis, card: string, amount: string) =>
    basis === 'actual' ? t('home.plan.basisActual', { card, amount })
      : basis === 'budget' ? t('home.plan.basisBudget', { card, amount })
      : basis === 'max' ? t('home.plan.basisMax', { card, amount })
      : t('home.plan.basisPosted', { card });

  return (
    <View style={styles.planCard}>
      <Text style={styles.badge}>{t('home.plan.badge')}</Text>

      <View>
        {plan.realClose !== null && (
          <Text style={styles.planSmall}>
            {t('home.plan.closesAt', { month: monthLabel, amount: money(plan.realClose) })}
          </Text>
        )}
        {plan.carriedIn !== null && (
          <Text style={[styles.planSmall, { color: PLAN.secondary }]}>
            {t('home.plan.carriedIn', { month: monthLabel, amount: money(plan.carriedIn) })}
          </Text>
        )}
      </View>

      <View>
        <Text style={styles.planQuestion}>{t('home.plan.question')}</Text>
        <Text style={styles.planLabel}>
          {plan.isPartialMonth
            ? t('home.plan.labelRemainder', { month: monthLabel })
            : t('home.plan.labelFull', { month: monthLabel })}
        </Text>
        <Text style={[styles.planFigure, plan.balance < 0 && { color: PLAN.negative }]}>
          {money(plan.balance)}
        </Text>
      </View>

      {plan.cards.length > 0 && (
        <View style={styles.planCards}>
          {plan.cards.map((card) => (
            <Text key={card.cardId} style={styles.planCardLine}>
              {cardLine(card.basis, card.cardName, money(card.amount))}
            </Text>
          ))}
        </View>
      )}

      {borrowed > 0 && (
        <Text style={styles.planBorrowed}>{t('home.plan.borrowedNote', { amount: money(borrowed) })}</Text>
      )}

      {plan.awaitingDates && (
        <Text style={[styles.planSmall, { color: PLAN.notice }]}>{t('home.awaitingDates')}</Text>
      )}

      <Text style={styles.planSmall}>{t('home.plan.note')}</Text>
    </View>
  );
}

// The web card's own blue and violet for these two rows; nothing else here uses them.
const SAVINGS_COLOR = '#0284C7';
const DEBT_COLOR = '#7C3AED';

export default function HomeScreen() {
  const { t, locale } = useI18n();
  const [load, setLoad] = useState<HomeLoad | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loading = load === null && errorKey === null;

  const fetchOutcome = useCallback(async (): Promise<Outcome> => {
    try {
      return { load: await loadHome(apiGet) };
    } catch (err) {
      console.error('Home load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: Outcome) => {
    if ('load' in outcome) {
      setLoad(outcome.load);
      setErrorKey(null);
    } else {
      setLoad(null);
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchOutcome();
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOutcome, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchOutcome());
    setRefreshing(false);
  }, [fetchOutcome, apply]);

  // A quick entry saved over this tab: refetch so the month includes it.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onEntrySaved(() => {
      void (async () => {
        const outcome = await fetchOutcome();
        if (!cancelled) apply(outcome);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchOutcome, apply]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} edges={['top']}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('tabs.home')}</Text>
            {load && <Text style={styles.month}>{formatMonthLong(load.month, locale)}</Text>}
          </View>
          <AddEntryButton />
        </View>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {load && <SnapshotCard snapshot={load.snapshot} />}
        {load && <PlanCard plan={load.plan} month={load.month} borrowed={load.snapshot.borrowed} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  header: { flex: 1, paddingHorizontal: theme.space.xs, gap: 2 },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading },
  month: { fontSize: 14, color: theme.color.muted },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: theme.color.heading },
  question: { fontSize: 13, fontWeight: '600', color: theme.color.muted },
  caption: { fontSize: 12, lineHeight: 17, color: theme.color.muted },
  notice: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.color.warning,
    backgroundColor: theme.color.warningSurface,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
  },
  subtraction: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
  },
  rowEmphasis: { borderTopWidth: 2, borderTopColor: theme.color.border, backgroundColor: theme.color.background },
  operator: { width: 12, textAlign: 'center', fontSize: 14, fontWeight: '600', color: theme.color.muted },
  rowLabel: { flex: 1, fontSize: 14, color: theme.color.muted },
  rowLabelEmphasis: { fontWeight: '600', color: theme.color.heading },
  rowValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueEmphasis: { fontSize: 19 },
  breakdown: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.background,
    paddingLeft: theme.space.xl,
    paddingRight: theme.space.md,
    paddingVertical: theme.space.sm,
    gap: theme.space.sm,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.space.sm },
  breakdownLabel: { flex: 1, fontSize: 14, color: theme.color.muted },
  breakdownValue: { fontSize: 14, color: SAVINGS_COLOR, fontVariant: ['tabular-nums'] },
  borrowedBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1.5,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
  },
  borrowedText: { fontSize: 14, fontWeight: '600', color: '#B91C1C' },
  planCard: {
    backgroundColor: PLAN.ground,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.color.accent,
    backgroundColor: PLAN.badgeGround,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
  },
  planSmall: { fontSize: 12, lineHeight: 17, color: PLAN.label },
  planQuestion: { fontSize: 14, fontWeight: '600', color: theme.color.accent },
  planLabel: { fontSize: 14, lineHeight: 20, color: PLAN.label },
  planFigure: { fontSize: 26, fontWeight: '700', color: PLAN.figure, fontVariant: ['tabular-nums'] },
  planCards: { gap: theme.space.xs },
  planCardLine: { fontSize: 12, lineHeight: 17, color: PLAN.card },
  planBorrowed: { fontSize: 14, fontWeight: '600', color: PLAN.card },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  errorText: { color: theme.color.danger, fontSize: 14 },
  retry: { color: theme.color.danger, fontSize: 14, fontWeight: '700' },
});
