import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet, messageKeyFor } from '../lib/api';
import { cadenceKey, loadRecurring, sectionsOf, type RecurringData, type RecurringLine } from '../lib/recurring';
import { cardFigure } from '../lib/cardsLoader';
import { onEntrySaved } from '../lib/entryEvents';
import { formatDayLong } from '../lib/timelineView';
import BackToMore from '../components/BackToMore';
import Chip from '../components/Chip';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Recurring income, bills and contributions (standalone S4), opened from More.
 * Lines onboarding left without a date come first: they are not in the plan
 * until dated. Tapping a line edits it; the "New" choices add one. Every
 * figure is the server's (GET /api/recurring).
 */
export default function RecurringScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<RecurringData | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (): Promise<{ data: RecurringData } | { errorKey: string }> => {
    try {
      return { data: await loadRecurring(apiGet) };
    } catch (err) {
      console.error('Recurring load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: { data: RecurringData } | { errorKey: string }) => {
    if ('data' in outcome) {
      setData(outcome.data);
      setErrorKey(null);
    } else {
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchData();
      if (!cancelled) apply(outcome);
    })();
    // A saved or deleted line (the editor emits this): reload.
    const unsubscribe = onEntrySaved(() => {
      void (async () => {
        const outcome = await fetchData();
        if (!cancelled) apply(outcome);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchData, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchData());
    setRefreshing(false);
  }, [fetchData, apply]);

  const open = (line: RecurringLine) => router.push({ pathname: '/recurring-edit', params: { id: line.id } });
  const create = (type: 'income' | 'expense' | 'transfer') => router.push({ pathname: '/recurring-edit', params: { type } });

  const row = (line: RecurringLine) => {
    const where = line.type === 'transfer' ? line.destinationName : line.type === 'expense' ? line.categoryName : line.accountName;
    const when = line.anchorDate ? `${t(cadenceKey(line.cadence))} · ${formatDayLong(line.anchorDate, locale)}` : t('recurring.noDate');
    return (
      <Pressable
        key={line.id}
        accessibilityRole="button"
        onPress={() => open(line)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>{line.description}</Text>
          <Text style={[styles.rowAmount, line.type === 'income' && { color: theme.color.positive }]}>
            {cardFigure(line.amount, locale)}
          </Text>
        </View>
        <Text style={styles.rowDetail} numberOfLines={1}>{where ? `${when} · ${where}` : when}</Text>
        {line.anchorDate === null && <Text style={styles.addDate}>{t('recurring.addDate')} ›</Text>}
      </Pressable>
    );
  };

  const section = (title: string, lines: RecurringLine[], hint?: string) =>
    lines.length === 0 ? null : (
      <View style={{ gap: theme.space.sm }}>
        <Text style={styles.section}>{title}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
        <View style={styles.card}>{lines.map(row)}</View>
      </View>
    );

  if (data === null && errorKey === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} edges={['top']}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  const sections = data ? sectionsOf(data.lines) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <BackToMore />
        <Text style={styles.title}>{t('recurring.title')}</Text>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {data && sections && (
          <>
            {data.lines.length === 0 && <Text style={styles.hint}>{t('recurring.empty')}</Text>}
            {section(t('recurring.sections.needsDate'), sections.needsDate, t('recurring.needsDateHint'))}
            {section(t('recurring.sections.income'), sections.income)}
            {section(t('recurring.sections.bills'), sections.bills)}
            {section(t('recurring.sections.contributions'), sections.contributions)}

            <View style={styles.chips}>
              <Chip label={`+ ${t('recurring.new.income')}`} selected={false} onPress={() => create('income')} />
              <Chip label={`+ ${t('recurring.new.expense')}`} selected={false} onPress={() => create('expense')} />
              {data.goalAccounts.length > 0 && (
                <Chip label={`+ ${t('recurring.new.transfer')}`} selected={false} onPress={() => create('transfer')} />
              )}
            </View>
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
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading, paddingHorizontal: theme.space.xs },
  section: { fontSize: 13, fontWeight: '700', color: theme.color.muted, paddingHorizontal: theme.space.xs },
  hint: { fontSize: 14, lineHeight: 21, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: theme.space.md,
  },
  row: { paddingVertical: 12, gap: 2 },
  pressed: { opacity: 0.6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.space.sm },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.color.body },
  rowAmount: { fontSize: 15, fontWeight: '700', color: theme.color.heading },
  rowDetail: { fontSize: 13, color: theme.color.muted },
  addDate: { fontSize: 13, fontWeight: '700', color: theme.color.heading },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
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
