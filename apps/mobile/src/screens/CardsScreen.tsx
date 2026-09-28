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
import { apiGet, messageKeyFor } from '../lib/api';
import { cardFigure, loadCards, type CardRow, type CardStatus, type CardsLoad } from '../lib/cardsLoader';
import { formatMonthLong } from '../lib/timelineView';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The card room: which credit card has room left this month. Read-only.
 *
 * Differences from the web panel (CrossCardView), on purpose:
 *   - shown for ONE card or more; the web shows it only beside 2+ card tabs,
 *     because there it sits above a per-card detail view. Here it is the whole
 *     screen, and one card's room is still the question.
 *   - current month only. No month picker, envelope editor or 12-month grid.
 *
 * Every figure is the server's (see cardsLoader.ts). A null goal or room
 * renders as "—", never $0.
 */

type Outcome = { load: CardsLoad } | { errorKey: string };

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
  const { t, locale } = useI18n();
  const [load, setLoad] = useState<CardsLoad | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loading = load === null && errorKey === null;

  const fetchOutcome = useCallback(async (): Promise<Outcome> => {
    try {
      return { load: await loadCards(apiGet) };
    } catch (err) {
      console.error('Cards load error:', err);
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
        <View style={styles.header}>
          <Text style={styles.title}>{t('cards.title')}</Text>
          {load && <Text style={styles.month}>{formatMonthLong(load.month, locale)}</Text>}
        </View>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {load?.kind === 'noCards' && <Text style={styles.empty}>{t('cards.noCards')}</Text>}

        {load?.kind === 'ready' && load.cards.map((card) => <CardRowView key={card.id} card={card} />)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  header: { paddingHorizontal: theme.space.xs, gap: 2 },
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
