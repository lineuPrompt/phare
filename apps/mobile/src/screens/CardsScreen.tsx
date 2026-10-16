import { useCallback, useEffect, useRef, useState } from 'react';
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
import { apiGet, messageKeyFor } from '../lib/api';
import { onEntrySaved } from '../lib/entryEvents';
import AddEntryButton from '../components/AddEntryButton';
import MonthNav from '../components/MonthNav';
import ActionButton from '../components/ActionButton';
import { useRouter } from 'expo-router';
import {
  cardFigure,
  loadCardMonths,
  loadCards,
  type CardMonths,
  type CardRow,
  type CardStatus,
  type CardsLoad,
} from '../lib/cardsLoader';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The card room: which credit card has room left this month. Read-only.
 *
 * Differences from the web panel (CrossCardView), on purpose:
 *   - shown for ONE card or more; the web shows it only beside 2+ card tabs,
 *     because there it sits above a per-card detail view. Here it is the whole
 *     screen, and one card's room is still the question.
 *   - month by month through the web picker's own range (/api/cards/months),
 *     but no envelope editor or 12-month grid yet.
 *
 * Every figure is the server's (see cardsLoader.ts). A null goal or room
 * renders as "—", never $0.
 */

type Outcome = { load: CardsLoad; range: CardMonths } | { errorKey: string };

const STATUS_COLOR: Record<CardStatus, string> = {
  over: theme.color.danger,
  watch: theme.color.warning,
  ok: theme.color.positive,
  unset: theme.color.muted,
};

function CardRowView({ card }: { card: CardRow }) {
  const { t, locale } = useI18n();

  // Literal keys, one per status, so the i18n parity test can see each one.
  const statusLabel =
    card.status === 'over' ? t('cards.status.over')
      : card.status === 'watch' ? t('cards.status.watch')
      : card.status === 'ok' ? t('cards.status.ok')
      : t('cards.status.noGoal');

  const roomNegative = card.remaining !== null && card.remaining < 0;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
        <Text style={[styles.status, { color: STATUS_COLOR[card.status] }]}>{statusLabel}</Text>
      </View>
      <View style={styles.figureRow}>
        <Text style={styles.figureLabel}>{t('cards.goal')}</Text>
        <Text style={styles.figureValue}>{cardFigure(card.goal, locale)}</Text>
      </View>
      <View style={styles.figureRow}>
        <Text style={styles.figureLabel}>{t('cards.spent')}</Text>
        <Text style={styles.figureValue}>{cardFigure(card.spent, locale)}</Text>
      </View>
      <View style={styles.figureRow}>
        <Text style={styles.figureLabel}>{t('cards.room')}</Text>
        <Text style={[styles.roomValue, roomNegative && { color: theme.color.danger }]}>
          {cardFigure(card.remaining, locale)}
        </Text>
      </View>
    </View>
  );
}

export default function CardsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [load, setLoad] = useState<CardsLoad | null>(null);
  const [range, setRange] = useState<CardMonths | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);
  // The month on screen, kept across refreshes and saved entries. null = the
  // current month.
  const monthRef = useRef<string | null>(null);

  const loading = load === null && errorKey === null;

  const fetchOutcome = useCallback(async (): Promise<Outcome> => {
    try {
      const nextRange = await loadCardMonths(apiGet);
      // A month that fell out of the range (the horizon moved) goes back to
      // the current month rather than showing an unreachable one.
      const month = monthRef.current !== null && nextRange.months.includes(monthRef.current) ? monthRef.current : null;
      if (month === null) monthRef.current = null;
      return { load: await loadCards(apiGet, undefined, month), range: nextRange };
    } catch (err) {
      console.error('Cards load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: Outcome) => {
    if ('load' in outcome) {
      setLoad(outcome.load);
      setRange(outcome.range);
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

  // On a failure the error shows and the old month stays on screen — its
  // figures are still true for the month its heading names.
  const selectMonth = useCallback(async (month: string) => {
    setPaging(true);
    try {
      const next = await loadCards(apiGet, undefined, month);
      monthRef.current = month;
      setLoad(next);
      setErrorKey(null);
    } catch (err) {
      console.error('Cards month load error:', err);
      setErrorKey(messageKeyFor(err));
    } finally {
      setPaging(false);
    }
  }, []);

  // A quick entry saved over this tab: refetch so Spent and Room include it.
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
            <Text style={styles.title}>{t('cards.title')}</Text>
          </View>
          <AddEntryButton />
        </View>

        {load && range && (
          <MonthNav
            months={range.months}
            month={load.month}
            currentMonth={range.currentMonth}
            onSelect={(month) => void selectMonth(month)}
          />
        )}
        {paging && <ActivityIndicator color={theme.color.heading} />}

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {load?.kind === 'noCards' && (
          <View style={styles.card}>
            <Text style={styles.empty}>{t('cards.noCards')}</Text>
            <ActionButton
              label={t('cards.addCard')}
              onPress={() => router.push({ pathname: '/account-new', params: { type: 'credit_card' } })}
            />
          </View>
        )}

        {load?.kind === 'ready' && load.cards.map((card) => <CardRowView key={card.id} card={card} />)}
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
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.space.sm,
  },
  cardName: { flex: 1, fontSize: 17, fontWeight: '700', color: theme.color.heading },
  status: { fontSize: 13, fontWeight: '700' },
  figureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  figureLabel: { fontSize: 14, color: theme.color.muted },
  figureValue: { fontSize: 15, color: theme.color.body },
  roomValue: { fontSize: 16, fontWeight: '700', color: theme.color.heading },
  empty: { fontSize: 15, lineHeight: 23, color: theme.color.muted, padding: theme.space.md },
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
