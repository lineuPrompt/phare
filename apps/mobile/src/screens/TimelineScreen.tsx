import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Link } from 'expo-router';
import { formatCADLocale, type DipStatus, type TimelineEntry, type UnbalancedDay } from '@phare/core';
import { apiGet, messageKeyFor } from '../lib/api';
import { createTimelineLoader, type LoadTrigger, type TimelineLoad } from '../lib/timelineLoader';
import {
  buildTimelineView,
  entryAmount,
  formatDayLong,
  formatDayShort,
  type AmountTone,
  type LedgerRow,
} from '../lib/timelineView';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import { theme } from '../theme';

/**
 * The Cash Timeline — read-only. "Will I dip before payday", on a phone.
 *
 * SECOND SCREEN, SAME SHAPE AS THE FIRST. The fetch/apply/outcome pattern, the
 * derived loading state, cancel-on-unmount, pull-to-refresh and
 * messageKeyFor() are ReviewScreen's, deliberately unchanged — see that file
 * for why each is the way it is.
 *
 * WHAT IT DOES NOT DO, all of it scope rather than omission: no month
 * navigation (the current month plus a run-on to the next pay — see
 * timelineView.ts), no editing or deleting entries, no adding an entry, no
 * re-anchoring, and no links out of a row. The web page's rows link to
 * /recurring, /savings, /cards and /reconcile, none of which exist here, and
 * /reconcile is internal-only.
 *
 * NO PRICE, NO PLAN NAME, NO UPGRADE PATH — Guideline 3.1.1, same as every
 * other screen. The web page shows an upgrade block when its month navigation
 * reaches the free horizon; this screen cannot reach that boundary, because
 * the current month is always inside it, so the paywall surface simply does
 * not exist here. `isPro` and `horizonEndMonth` arrive in the payload and only
 * ever cap how far the run-on may go.
 */

type Outcome = { load: TimelineLoad } | { errorKey: string };

const TONE: Record<AmountTone, string> = {
  income: theme.color.positive,
  draw: theme.color.warning,
  plain: theme.color.body,
};

/** classifyDip's tiers, as colours. One amber, unlike the web page. */
const DIP_PALETTE: Record<DipStatus, { surface: string; border: string; text: string }> = {
  none: { surface: theme.color.background, border: theme.color.border, text: theme.color.muted },
  healthy: { surface: theme.color.accentSurface, border: theme.color.accentSurface, text: theme.color.heading },
  amber: { surface: theme.color.warningSurface, border: theme.color.warning, text: theme.color.warning },
  red: { surface: theme.color.dangerSurface, border: theme.color.danger, text: theme.color.danger },
};

function EntryRow({ entry, locale, muted }: { entry: TimelineEntry; locale: Locale; muted?: boolean }) {
  const { t } = useI18n();
  const amount = entryAmount(entry, locale);

  return (
    <View style={styles.entryRow}>
      <Text style={[styles.entryLabel, muted && styles.entryMuted]} numberOfLines={1}>
        {/* The web page's row markers, kept: a bridge is computed from a card's
            cycle, a draw is borrowed money, a transfer leaves for a goal, and
            a recurring occurrence came from a rule. */}
        {entry.isBridge ? '💳 ' : ''}
        {entry.type === 'transfer' && !entry.isBridge ? (entry.amount < 0 ? '🚨 ' : '🪙 ') : ''}
        {!entry.isBridge && entry.recurringItemId !== null && entry.type !== 'transfer' ? '🔁 ' : ''}
        {entry.description ?? t('timeline.list.untitled')}
      </Text>
      {entry.installmentLabel && <Text style={styles.installment}>{entry.installmentLabel}</Text>}
      <Text
        style={[
          styles.entryAmount,
          { color: muted ? theme.color.muted : TONE[amount.tone] },
          entry.isFuture && styles.future,
        ]}
      >
        {amount.text}
      </Text>
    </View>
  );
}

function UnbalancedCard({ day, locale }: { day: UnbalancedDay; locale: Locale }) {
  const { t } = useI18n();
  return (
    <View style={styles.unbalancedCard}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayMuted}>{formatDayShort(day.date, locale)}</Text>
        <Text style={styles.noBalance}>{t('timeline.list.noBalanceYet')}</Text>
      </View>
      {day.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          // An unbalanced entry is a TimelineTx: no running balance exists for
          // it, so it has no signedAmount and is never "future" — it already
          // happened, before the first anchor.
          entry={{ ...entry, signedAmount: 0, isFuture: false }}
          locale={locale}
          muted
        />
      ))}
    </View>
  );
}

export default function TimelineScreen() {
  const { t, locale } = useI18n();
  const [load, setLoad] = useState<TimelineLoad | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loading = load === null && errorKey === null;

  // ONE LOADER PER MOUNT, which is what makes the pageView marker fire once
  // per screen open rather than once per request. Held in state (not a ref
  // rebuilt on render) so the flag inside it survives re-renders.
  const [loader] = useState(() => createTimelineLoader(apiGet));

  const scrollRef = useRef<ScrollView | null>(null);
  const rowOffsets = useRef<Record<number, number>>({});
  const hasScrolled = useRef(false);

  const fetchOutcome = useCallback(
    async (trigger: LoadTrigger): Promise<Outcome> => {
      try {
        return { load: await loader.load(trigger) };
      } catch (err) {
        return { errorKey: messageKeyFor(err) };
      }
    },
    [loader]
  );

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
      const outcome = await fetchOutcome('open');
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOutcome, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // 'refresh', never 'open': a pull must not log a second Timeline open.
    apply(await fetchOutcome('refresh'));
    setRefreshing(false);
  }, [fetchOutcome, apply]);

  const view = useMemo(
    () => (load?.kind === 'ready' ? buildTimelineView(load.data, load.today) : null),
    [load]
  );

  // Today is mid-month by definition, so the rows above it are spent days.
  // Scrolling once, after layout, puts the useful part on screen without
  // taking the scroll position away from the user afterwards.
  const onRowLayout = useCallback(
    (index: number, y: number) => {
      rowOffsets.current[index] = y;
      const target = view?.scrollToRow;
      if (hasScrolled.current || target == null || target !== index) return;
      hasScrolled.current = true;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: false });
    },
    [view]
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{t('timeline.title')}</Text>
      <Link href="/" replace style={styles.navLink}>
        {t('timeline.backToReview')}
      </Link>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {header}

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {load?.kind === 'noChequing' && <Text style={styles.empty}>{t('timeline.noChequing')}</Text>}

        {load?.kind === 'noAnchor' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('timeline.noAnchor.title')}</Text>
            <Text style={styles.cardBody}>{t('timeline.noAnchor.body')}</Text>
          </View>
        )}

        {load?.kind === 'ready' && view && (
          <>
            <DipHeader
              todayBalance={load.data.todayBalance}
              dip={load.data.dip}
              nextIncomeDate={load.data.nextIncomeDate}
              status={view.dipStatus}
              locale={locale}
            />

            {view.monthView && view.lowestStatus && (
              <View style={styles.card}>
                <StripRow label={t('timeline.list.opensAt')} value={formatCADLocale(view.monthView.opensAt, locale)} />
                <StripRow
                  label={t('timeline.list.lowestThisMonth')}
                  value={`${formatCADLocale(view.monthView.lowest.balance, locale)} ${t('timeline.list.lowestOn', {
                    date: formatDayShort(view.monthView.lowest.date, locale),
                  })}`}
                  color={
                    view.lowestStatus === 'red'
                      ? theme.color.danger
                      : view.lowestStatus === 'amber'
                        ? theme.color.warning
                        : theme.color.heading
                  }
                />
                <StripRow label={t('timeline.list.closesAt')} value={formatCADLocale(view.monthView.closesAt, locale)} />
              </View>
            )}

            {/* No days for this month at all: the anchor is later than today,
                so there is nothing to show and $0 would be a lie. */}
            {!view.monthView && (
              <Text style={styles.empty}>
                {t('timeline.list.balancesBegin', {
                  date: formatDayShort(load.data.balancesStartDate, locale),
                })}
              </Text>
            )}

            {view.monthView && view.rows.length === 0 && (
              <Text style={styles.empty}>{t('timeline.list.empty')}</Text>
            )}

            {view.rows.map((row, index) => (
              <View key={rowKey(row, index)} onLayout={(e) => onRowLayout(index, e.nativeEvent.layout.y)}>
                <Row row={row} locale={locale} />
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function rowKey(row: LedgerRow, index: number): string {
  if (row.kind === 'day' || row.kind === 'unbalanced') return `${row.kind}-${row.day.date}`;
  return `${row.kind}-${index}`;
}

function Row({ row, locale }: { row: LedgerRow; locale: Locale }) {
  const { t } = useI18n();

  if (row.kind === 'unbalanced') return <UnbalancedCard day={row.day} locale={locale} />;

  if (row.kind === 'balancesBegin') {
    return (
      <Text style={styles.note}>
        {t('timeline.list.balancesBegin', { date: formatDayShort(row.date, locale) })}
      </Text>
    );
  }

  if (row.kind === 'projection') {
    return (
      <View style={styles.divider}>
        <Text style={styles.badge}>{t('timeline.list.projectionBadge')}</Text>
        <Text style={styles.dividerText}>{t('timeline.list.projectionNote')}</Text>
      </View>
    );
  }

  if (row.kind === 'runOn') {
    return (
      <View style={styles.divider}>
        <Text style={styles.dividerText}>
          {t('timeline.list.untilNextPay', { payday: formatDayLong(row.payday, locale) })}
        </Text>
      </View>
    );
  }

  const { day, isToday } = row;
  return (
    <View
      style={[
        styles.dayCard,
        day.isNegative && styles.dayNegative,
        !day.isNegative && isToday && styles.dayToday,
      ]}
    >
      <View style={styles.dayHeader}>
        <Text style={[styles.dayTitle, day.isNegative && styles.dayTitleNegative]}>
          {formatDayShort(day.date, locale)}
        </Text>
        {isToday && <Text style={styles.todayPill}>{t('timeline.list.today')}</Text>}
      </View>

      {day.entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} locale={locale} />
      ))}

      <View style={[styles.endOfDay, day.isNegative && styles.endOfDayNegative]}>
        <Text style={[styles.endOfDayLabel, day.isNegative && styles.dayTitleNegative]}>
          {t('timeline.list.endOfDay')}
        </Text>
        <Text style={[styles.endOfDayValue, day.isNegative && styles.dayTitleNegative]}>
          {formatCADLocale(day.endOfDayBalance, locale)}
        </Text>
      </View>
    </View>
  );
}

function StripRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stripRow}>
      <Text style={styles.stripLabel}>{label}</Text>
      <Text style={[styles.stripValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function DipHeader({
  todayBalance,
  dip,
  nextIncomeDate,
  status,
  locale,
}: {
  todayBalance: number | null;
  dip: { date: string; balance: number } | null;
  nextIncomeDate: string | null;
  status: DipStatus;
  locale: Locale;
}) {
  const { t } = useI18n();
  const palette = DIP_PALETTE[status];
  // Only read when a dip exists, and the route sends both together or neither.
  const payday = nextIncomeDate ? formatDayLong(nextIncomeDate, locale) : '';

  return (
    <View style={styles.card}>
      <Text style={styles.balanceLabel}>{t('timeline.header.balanceToday')}</Text>
      {/* null is not zero: today outside the returned window has no balance
          to report, and $0 would read as an empty account. */}
      <Text style={styles.balanceValue}>
        {todayBalance !== null ? formatCADLocale(todayBalance, locale) : '—'}
      </Text>

      <View style={[styles.dipBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {dip === null ? (
          <Text style={[styles.dipText, { color: palette.text }]}>{t('timeline.header.noDip')}</Text>
        ) : (
          <Text style={[styles.dipText, { color: palette.text }]}>
            {status === 'red'
              ? t('timeline.header.dipsBelowZeroBeforePay', { payday })
              : t('timeline.header.lowestBeforePay', { payday })}{' '}
            <Text style={styles.dipFigure}>
              {formatCADLocale(dip.balance, locale)} {t('timeline.header.on')}{' '}
              {formatDayLong(dip.date, locale)}
            </Text>
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.xs,
    marginBottom: theme.space.xs,
  },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading },
  navLink: { fontSize: 14, color: theme.color.muted },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: theme.color.heading, lineHeight: 24 },
  cardBody: { fontSize: 14, lineHeight: 21, color: theme.color.muted },
  balanceLabel: { fontSize: 13, color: theme.color.muted },
  balanceValue: { fontSize: 30, fontWeight: '700', color: theme.color.heading },
  dipBox: {
    marginTop: theme.space.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    padding: theme.space.md,
  },
  dipText: { fontSize: 14, lineHeight: 21 },
  dipFigure: { fontWeight: '700' },
  stripRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space.sm },
  stripLabel: { fontSize: 13, color: theme.color.muted },
  stripValue: { fontSize: 14, fontWeight: '600', color: theme.color.heading, flexShrink: 1, textAlign: 'right' },
  dayCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.sm,
  },
  dayNegative: { backgroundColor: theme.color.dangerSurface, borderColor: theme.color.danger, borderWidth: 1.5 },
  dayToday: { backgroundColor: theme.color.accentSurface, borderColor: theme.color.accent, borderWidth: 1.5 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  dayTitle: { fontSize: 14, fontWeight: '700', color: theme.color.heading },
  dayTitleNegative: { color: theme.color.danger },
  dayMuted: { fontSize: 14, fontWeight: '700', color: theme.color.muted },
  todayPill: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.surface,
    backgroundColor: theme.color.accent,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: 3 },
  entryLabel: { flex: 1, fontSize: 14, color: theme.color.body },
  entryMuted: { color: theme.color.muted },
  entryAmount: { fontSize: 14, fontWeight: '600' },
  future: { opacity: 0.75 },
  installment: {
    fontSize: 11,
    color: theme.color.muted,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.xs,
    overflow: 'hidden',
  },
  endOfDay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    marginTop: theme.space.xs,
    paddingTop: theme.space.xs,
  },
  endOfDayNegative: { borderTopColor: theme.color.dangerBorder },
  endOfDayLabel: { fontSize: 12, color: theme.color.muted },
  endOfDayValue: { fontSize: 14, fontWeight: '700', color: theme.color.heading },
  divider: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingTop: theme.space.md, paddingBottom: theme.space.xs },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.color.muted,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  dividerText: { flex: 1, fontSize: 12, color: theme.color.muted },
  unbalancedCard: {
    backgroundColor: theme.color.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.color.border,
    padding: theme.space.sm,
  },
  noBalance: { fontSize: 11, fontStyle: 'italic', color: theme.color.muted },
  note: { fontSize: 12, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  empty: { fontSize: 14, lineHeight: 21, color: theme.color.muted, padding: theme.space.md },
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
