import { StyleSheet, Text, View } from 'react-native';
import { classifyDip, formatCADLocale, type DipInfo, type DipStatus } from '@phare/core';
import { formatDayLong } from '../lib/timelineView';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n';
import { theme } from '../theme';

/** classifyDip's tiers, as colours. One amber, unlike the web page. */
const DIP_PALETTE: Record<DipStatus, { surface: string; border: string; text: string }> = {
  none: { surface: theme.color.background, border: theme.color.border, text: theme.color.muted },
  healthy: { surface: theme.color.accentSurface, border: theme.color.accentSurface, text: theme.color.heading },
  amber: { surface: theme.color.warningSurface, border: theme.color.warning, text: theme.color.warning },
  red: { surface: theme.color.dangerSurface, border: theme.color.danger, text: theme.color.danger },
};

/**
 * "Balance today" and the lowest point before the next pay — the Timeline's
 * header card, also shown on Home above the snapshot (Lineu, 2026-11-01).
 * One component on both tabs, fed the same /api/timeline fields, so the two
 * can never disagree. Today-anchored: it does not follow month navigation.
 */
export default function BalanceTodayCard({
  todayBalance,
  dip,
  nextIncomeDate,
  locale,
}: {
  todayBalance: number | null;
  dip: DipInfo | null;
  nextIncomeDate: string | null;
  locale: Locale;
}) {
  const { t } = useI18n();
  const status = classifyDip(dip);
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
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
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
});
