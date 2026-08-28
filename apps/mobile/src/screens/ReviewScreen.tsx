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
import { Link } from 'expo-router';
import { formatCADLocale } from '@phare/core';
import { fetchReviews, type ArchiveLetter, type ArchiveMonth, type ReviewArchive } from '../lib/reviews';
import { messageKeyFor } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import LockedNotice from '../components/LockedNotice';
import { theme } from '../theme';

/**
 * The one screen. Read-only, GET /api/reviews.
 *
 * It exercises the whole chain in one place: the bearer token from SecureStore,
 * an authenticated route that derives the household server-side, the paywall
 * applied before the payload leaves the server, and @phare/core doing the money
 * formatting.
 *
 * WHY formatCADLocale AND NOT formatCAD: formatCAD takes no locale and always
 * renders en-CA — see packages/core/money.ts and its README's Known
 * Limitations. Using it here would show a French household "$1,234.50" where
 * Québécois French is "1 234,50 $", reproducing on mobile a bug the web app is
 * already carrying. formatCADLocale is the same package's locale-aware
 * function, already pinned to the codepoint by money.test.ts, and its own doc
 * comment says it exists for exactly this consumer. No second formatter is
 * introduced either way.
 */

/** 'YYYY-MM' → "August 2026" / « août 2026 ». */
function formatMonth(month: string, locale: Locale): string {
  const [year, m] = month.split('-').map(Number);
  // Noon UTC, so no time zone can push this into the adjacent month. The day
  // is irrelevant — only the month and year are rendered.
  const date = new Date(Date.UTC(year, m - 1, 15, 12));
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function Letter({ letter }: { letter: ArchiveLetter }) {
  const { t } = useI18n();

  return (
    <View style={styles.letter}>
      {letter.topRecommendation && (
        <View style={styles.recommendation}>
          <Text style={styles.recommendationLabel}>{t('review.recommendation')}</Text>
          <Text style={styles.recommendationText}>{letter.topRecommendation}</Text>
        </View>
      )}

      {letter.review && <Text style={styles.reviewText}>{letter.review}</Text>}

      {/* The server already removed the rest. This only reports that it did. */}
      {letter.reviewLocked && <LockedNotice />}
    </View>
  );
}

function MonthCard({ month }: { month: ArchiveMonth }) {
  const { t, locale } = useI18n();

  return (
    <View style={styles.card}>
      <Text style={styles.monthTitle}>{formatMonth(month.month, locale)}</Text>

      <View style={styles.figureRow}>
        <Text style={styles.figureLabel}>{t('review.netCashFlow')}</Text>
        <Text style={styles.figureValue}>
          {/* null is NOT zero. A month with no ledger data has no net cash
              flow to report, and $0 would read as "it broke even". */}
          {month.netCashFlow === null
            ? t('review.netCashFlowUnknown')
            : formatCADLocale(month.netCashFlow, locale)}
        </Text>
      </View>

      <Letter letter={month.letter} />
    </View>
  );
}

/** The result of one /api/reviews attempt — data or a message key, never both. */
type Outcome = { archive: ReviewArchive } | { errorKey: string };

export default function ReviewScreen() {
  const { t } = useI18n();
  const [archive, setArchive] = useState<ReviewArchive | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // DERIVED, not stored. A separate `loading` flag was a third piece of state
  // that had to be kept consistent with the other two by hand, and getting it
  // wrong shows a spinner forever. There are only three states here and this
  // expression is all of them: nothing fetched and nothing failed means the
  // first fetch is still in flight.
  const loading = archive === null && errorKey === null;

  // FETCHING AND APPLYING ARE SEPARATE, so the mount effect and pull-to-refresh
  // share one request path without either duplicating it. Splitting them is
  // also what lets the effect discard a result after unmount: `apply` is not
  // called at all in that case, rather than called and ignored.
  const fetchOutcome = useCallback(async (): Promise<Outcome> => {
    try {
      return { archive: await fetchReviews() };
    } catch (err) {
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  // Both states are settled together from one outcome. Clearing the error up
  // front instead read as a synchronous setState from the mount effect
  // (react-hooks/set-state-in-effect), and it blanked a visible error the
  // instant pull-to-refresh started — the screen emptied, then repopulated
  // with the same error.
  const apply = useCallback((outcome: Outcome) => {
    if ('archive' in outcome) {
      setArchive(outcome.archive);
      setErrorKey(null);
    } else {
      setArchive(null);
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    // Started from inside an async function rather than called straight from
    // the effect body: anything reaching setState synchronously from here is
    // the cascading-render pattern the lint rule names.
    //
    // `cancelled` is not lint appeasement — without it, signing out or
    // navigating away mid-request lands a state update on an unmounted screen.
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
      <SafeAreaView style={[styles.safe, styles.centred]}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  const hasContent = archive && (archive.months.length > 0 || archive.startingPlan);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('review.title')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void supabase.auth.signOut()}
            hitSlop={8}
          >
            <Text style={styles.signOut}>{t('common.signOut')}</Text>
          </Pressable>
        </View>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {!errorKey && !hasContent && <Text style={styles.empty}>{t('review.empty')}</Text>}

        {archive?.months.map((month) => <MonthCard key={month.letter.id} month={month} />)}

        {archive?.startingPlan && (
          <View style={styles.card}>
            <Text style={styles.monthTitle}>{t('review.startingPlan')}</Text>
            <Letter letter={archive.startingPlan} />
          </View>
        )}

        {/* Development aid, not a product surface — see DiagnosticsScreen. */}
        <Link href="/diagnostics" style={styles.diagnosticsLink}>
          {t('diagnostics.title')}
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.xs,
  },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading },
  signOut: { fontSize: 14, color: theme.color.muted },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  monthTitle: { fontSize: 18, fontWeight: '700', color: theme.color.heading },
  figureRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  figureLabel: { fontSize: 13, color: theme.color.muted },
  figureValue: { fontSize: 16, fontWeight: '600', color: theme.color.body },
  letter: { gap: theme.space.sm },
  recommendation: {
    borderLeftWidth: 3,
    borderLeftColor: theme.color.heading,
    paddingLeft: theme.space.sm,
    gap: 2,
  },
  recommendationLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.color.muted,
  },
  recommendationText: { fontSize: 15, lineHeight: 22, color: theme.color.body },
  reviewText: { fontSize: 15, lineHeight: 23, color: theme.color.body },
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
  diagnosticsLink: {
    fontSize: 13,
    color: theme.color.muted,
    textAlign: 'center',
    paddingVertical: theme.space.md,
  },
});
