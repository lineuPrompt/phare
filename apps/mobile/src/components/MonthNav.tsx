import { Pressable, StyleSheet, Text, View } from 'react-native';
import { monthNeighbours } from '@phare/core';
import { formatMonthLong } from '../lib/timelineView';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * ◀ October 2026 ▶, and "This month" when away from it. Shared by Home,
 * Timeline and Cards.
 *
 * WHERE THE ARROWS GO IS NOT DECIDED HERE. Each screen passes the months its
 * own route says are reachable (the web page's own range — see each loader),
 * and monthNeighbours (@phare/core) picks the nearest one either side. An end
 * of the range is a missing arrow, with no explanation: on a free household
 * the forward end is the entitled horizon, and saying what lies past it would
 * be steering toward a purchase (Guideline 3.1.1).
 */
export default function MonthNav({
  months,
  month,
  currentMonth,
  onSelect,
}: {
  /** Ascending YYYY-MM months this screen may show. */
  months: readonly string[];
  /** The month on screen. */
  month: string;
  /** The household's current month (businessMonth), for "This month". */
  currentMonth: string;
  onSelect: (month: string) => void;
}) {
  const { t, locale } = useI18n();
  const { previous, next } = monthNeighbours(months, month);

  return (
    <View style={styles.bar}>
      <Arrow label={t('common.monthNav.previous')} glyph="‹" target={previous} onSelect={onSelect} />
      <View style={styles.centre}>
        <Text style={styles.month}>{formatMonthLong(month, locale)}</Text>
        {month !== currentMonth && (
          <Pressable accessibilityRole="button" onPress={() => onSelect(currentMonth)} hitSlop={8}>
            <Text style={styles.thisMonth}>{t('common.monthNav.thisMonth')}</Text>
          </Pressable>
        )}
      </View>
      <Arrow label={t('common.monthNav.next')} glyph="›" target={next} onSelect={onSelect} />
    </View>
  );
}

function Arrow({
  label,
  glyph,
  target,
  onSelect,
}: {
  label: string;
  glyph: string;
  target: string | null;
  onSelect: (month: string) => void;
}) {
  // A disabled arrow keeps its space, so the month label does not jump
  // sideways at either end of the range.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: target === null }}
      disabled={target === null}
      onPress={() => target && onSelect(target)}
      hitSlop={8}
      style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
    >
      <Text style={[styles.glyph, target === null && styles.glyphDisabled]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingVertical: theme.space.xs,
  },
  centre: { flex: 1, alignItems: 'center', gap: 2 },
  month: { fontSize: 16, fontWeight: '700', color: theme.color.heading },
  thisMonth: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  glyph: { fontSize: 30, lineHeight: 32, color: theme.color.heading },
  glyphDisabled: { color: theme.color.border },
});
