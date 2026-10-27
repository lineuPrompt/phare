import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet, messageKeyFor } from '../lib/api';
import { loadGoals, type Goal } from '../lib/goals';
import { cadenceKey } from '../lib/recurring';
import { cardFigure } from '../lib/cardsLoader';
import { onEntrySaved } from '../lib/entryEvents';
import { formatDayLong } from '../lib/timelineView';
import ActionButton from '../components/ActionButton';
import BackToMore from '../components/BackToMore';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Goals: savings goals and debts, from More (as on the web sidebar). Every
 * figure is the server's (GET /api/goals). "Add money" opens quick entry on
 * Contribution with this goal chosen; a new goal is a new savings account.
 */
export default function GoalsScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGoals = useCallback(async (): Promise<{ goals: Goal[] } | { errorKey: string }> => {
    try {
      return { goals: await loadGoals(apiGet) };
    } catch (err) {
      console.error('Goals load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: { goals: Goal[] } | { errorKey: string }) => {
    if ('goals' in outcome) {
      setGoals(outcome.goals);
      setErrorKey(null);
    } else {
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchGoals();
      if (!cancelled) apply(outcome);
    })();
    const unsubscribe = onEntrySaved(() => {
      void (async () => {
        const outcome = await fetchGoals();
        if (!cancelled) apply(outcome);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchGoals, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchGoals());
    setRefreshing(false);
  }, [fetchGoals, apply]);

  if (goals === null && errorKey === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} edges={['top']}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <BackToMore />
        <Text style={styles.title}>{t('goals.title')}</Text>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {goals && goals.length === 0 && <Text style={styles.hint}>{t('goals.empty')}</Text>}

        {goals?.map((g) => (
          <View key={g.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
              <Text style={[styles.balance, g.balance < 0 && { color: theme.color.danger }]}>{cardFigure(g.balance, locale)}</Text>
            </View>
            <Text style={styles.detail}>{g.isDebt ? t('goals.owedToday') : t('goals.savedToday')}</Text>
            {g.target !== null && !g.isDebt && (
              <Text style={styles.detail}>
                {t('goals.target')} {cardFigure(g.target, locale)}
                {g.targetDate ? ` · ${t('goals.by')} ${formatDayLong(g.targetDate, locale)}` : ''}
              </Text>
            )}
            {g.isDebt && g.targetDate && (
              <Text style={styles.detail}>{t('goals.payoffBy')} {formatDayLong(g.targetDate, locale)}</Text>
            )}
            {g.contribution && (
              <Text style={styles.detail}>
                {t('goals.contribution')} {cardFigure(g.contribution.amount, locale)} · {t(cadenceKey(g.contribution.cadence))}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/add', params: { kind: 'transfer', goalId: g.id } })}
              hitSlop={8}
            >
              <Text style={styles.action}>{g.isDebt ? t('goals.makePayment') : t('goals.addMoney')} ›</Text>
            </Pressable>
            {!g.isDebt && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/add', params: { kind: 'transfer', goalId: g.id, transferKind: 'draw' } })}
                hitSlop={8}
              >
                <Text style={styles.action}>{t('goals.withdraw')} ›</Text>
              </Pressable>
            )}
          </View>
        ))}

        {goals && (
          <ActionButton
            label={t('goals.newGoal')}
            onPress={() => router.push({ pathname: '/account-new', params: { type: 'savings' } })}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading, paddingHorizontal: theme.space.xs },
  hint: { fontSize: 14, lineHeight: 21, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space.sm },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: theme.color.heading },
  balance: { fontSize: 17, fontWeight: '700', color: theme.color.heading },
  detail: { fontSize: 13, color: theme.color.muted },
  action: { fontSize: 14, fontWeight: '700', color: theme.color.heading, marginTop: theme.space.sm },
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
