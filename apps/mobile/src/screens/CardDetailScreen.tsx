import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, messageKeyFor } from '../lib/api';
import { canEditPlan, loadCardDetail, type BudgetStatus, type CardDetail } from '../lib/cardPlan';
import { cardFigure } from '../lib/cardsLoader';
import { onEntrySaved } from '../lib/entryEvents';
import { formatMonthLong } from '../lib/timelineView';
import ActionButton from '../components/ActionButton';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * One card for one month (standalone S5): its goal, what it has spent, and
 * each category's budget against its spend — the web Cards page's decision
 * view. Every figure is the server's (GET /api/card-envelope); nothing here
 * adds or subtracts. "Edit plan" is offered for an open or future statement
 * only: a closed one keeps the plan it had.
 */

const STATUS_COLOR: Record<BudgetStatus, string> = {
  over: theme.color.danger,
  watch: theme.color.warning,
  ok: theme.color.positive,
  unset: theme.color.muted,
};

export default function CardDetailScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; month?: string }>();
  const cardId = typeof params.cardId === 'string' ? params.cardId : null;
  const month = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;

  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDetail = useCallback(async (): Promise<{ detail: CardDetail } | { errorKey: string }> => {
    if (!cardId || !month) return { errorKey: 'cardPlan.errors.notFound' };
    try {
      return { detail: await loadCardDetail(apiGet, cardId, month, locale) };
    } catch (err) {
      console.error('Card detail load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, [cardId, month, locale]);

  const apply = useCallback((outcome: { detail: CardDetail } | { errorKey: string }) => {
    if ('detail' in outcome) {
      setDetail(outcome.detail);
      setErrorKey(null);
    } else {
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchDetail();
      if (!cancelled) apply(outcome);
    })();
    // A saved plan or entry anywhere: reload so the figures include it.
    const unsubscribe = onEntrySaved(() => {
      void (async () => {
        const outcome = await fetchDetail();
        if (!cancelled) apply(outcome);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchDetail, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchDetail());
    setRefreshing(false);
  }, [fetchDetail, apply]);

  const header = (
    <View style={styles.headerRow}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{detail?.card.name ?? t('cards.title')}</Text>
        {month && <Text style={styles.subtitle}>{formatMonthLong(month, locale)}</Text>}
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  if (detail === null && errorKey === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  const cycleLine = detail
    ? detail.cycleState === 'closed' ? t('cardPlan.cycle.closed')
      : detail.cycleState === 'future' ? t('cardPlan.cycle.future')
      : t('cardPlan.cycle.open')
    : null;

  const planned = detail?.budgets.filter((b) => b.planned) ?? [];
  const unplanned = detail?.budgets.filter((b) => !b.planned) ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
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

        {detail && (
          <>
            <Text style={styles.cycle}>{cycleLine}</Text>
            {detail.cycleState === 'closed' && detail.pastPlan === 'goalOnly' && (
              <Text style={styles.cycle}>{t('cardPlan.pastPlan.goalOnly')}</Text>
            )}
            {detail.cycleState === 'closed' && detail.pastPlan === 'none' && (
              <Text style={styles.cycle}>{t('cardPlan.pastPlan.none')}</Text>
            )}

            <View style={styles.card}>
              <View style={styles.figureRow}>
                <Text style={styles.figureLabel}>{t('cards.goal')}</Text>
                <Text style={styles.figureStrong}>{cardFigure(detail.totalGoal, locale)}</Text>
              </View>
              <View style={styles.figureRow}>
                <Text style={styles.figureLabel}>{t('cards.spent')}</Text>
                <Text style={styles.figureValue}>{cardFigure(detail.totalSpent, locale)}</Text>
              </View>
            </View>

            <Text style={styles.section}>{t('cardPlan.budgets')}</Text>
            <View style={styles.card}>
              {planned.length === 0 && <Text style={styles.empty}>{t('cardPlan.noBudgets')}</Text>}
              {planned.map((b) => (
                <View key={b.categoryId} style={styles.budget}>
                  <View style={styles.figureRow}>
                    <Text style={styles.budgetName} numberOfLines={1}>{b.categoryName}</Text>
                    <Text style={[styles.figureStrong, { color: STATUS_COLOR[b.status] }]}>
                      {cardFigure(b.remaining, locale)}
                    </Text>
                  </View>
                  <Text style={styles.budgetDetail}>
                    {t('cards.spent')} {cardFigure(b.actual, locale)} · {t('cardPlan.budget')} {cardFigure(b.monthlyAmount, locale)}
                  </Text>
                </View>
              ))}
              {unplanned.map((b) => (
                <View key={b.categoryId} style={styles.budget}>
                  <View style={styles.figureRow}>
                    <Text style={styles.budgetName} numberOfLines={1}>{b.categoryName}</Text>
                    <Text style={styles.figureValue}>{cardFigure(b.actual, locale)}</Text>
                  </View>
                  <Text style={styles.budgetDetail}>{t('cardPlan.noBudget')}</Text>
                </View>
              ))}
              {detail.uncategorized !== 0 && (
                <View style={styles.figureRow}>
                  <Text style={styles.budgetName}>{t('cardPlan.uncategorized')}</Text>
                  <Text style={styles.figureValue}>{cardFigure(detail.uncategorized, locale)}</Text>
                </View>
              )}
            </View>

            {canEditPlan(detail) && cardId && month && (
              <ActionButton
                label={t('cardPlan.edit')}
                onPress={() => router.push({ pathname: '/card-edit', params: { cardId, month } })}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space.sm },
  header: { flex: 1, paddingHorizontal: theme.space.xs, gap: 2 },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.heading },
  subtitle: { fontSize: 14, color: theme.color.muted },
  close: { fontSize: 15, color: theme.color.muted },
  cycle: { fontSize: 14, lineHeight: 21, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  section: { fontSize: 13, fontWeight: '700', color: theme.color.muted, paddingHorizontal: theme.space.xs, marginTop: theme.space.sm },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.md,
  },
  figureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space.sm },
  figureLabel: { fontSize: 14, color: theme.color.muted },
  figureValue: { fontSize: 15, color: theme.color.body },
  figureStrong: { fontSize: 16, fontWeight: '700', color: theme.color.heading },
  budget: { gap: 2 },
  budgetName: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.color.body },
  budgetDetail: { fontSize: 13, color: theme.color.muted },
  empty: { fontSize: 14, color: theme.color.muted },
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
