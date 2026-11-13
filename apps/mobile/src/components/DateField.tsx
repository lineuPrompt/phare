import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useI18n } from '../i18n';
import { formatDateLong } from '../lib/timelineView';
import { isoToPickerDate, pickerDateToIso, pickerStart } from '../lib/datePicker';
import { formStyles } from './formStyles';
import { theme } from '../theme';

/**
 * Every date in the app's forms is picked, not typed (Lineu, 2026-11-13).
 *
 * The form keeps its 'YYYY-MM-DD' string; this only changes how it is chosen.
 * Tap the field: Android opens the system date dialog, iOS opens an inline
 * calendar under the field that closes on the day tapped. The field reads the
 * day back in words ("13 November 2026"), in the app's language.
 *
 * `fallback` is the household's today: where the calendar opens when the field
 * is still empty. Without one the field waits (disabled) rather than open on
 * the device's own clock — the household's timezone is the only date boundary.
 * `onClear` adds a "clear" link for optional dates (a rule's end date).
 */
export default function DateField({
  value,
  onChange,
  fallback,
  placeholder,
  accessibilityLabel,
  onClear,
  clearLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  fallback?: string;
  placeholder: string;
  accessibilityLabel: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const start = pickerStart(value, fallback);
  const shown = isoToPickerDate(value) ? formatDateLong(value, locale) : null;

  const pick = (date: Date | undefined) => {
    if (date) onChange(pickerDateToIso(date));
  };

  const press = () => {
    if (!start) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: start,
        mode: 'date',
        onValueChange: (_event, date) => pick(date),
      });
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: shown ?? placeholder }}
        accessibilityState={{ disabled: !start, expanded: Platform.OS === 'ios' ? open : undefined }}
        disabled={!start}
        onPress={press}
        style={[formStyles.input, styles.field, open && styles.fieldOpen]}
      >
        <Text style={shown ? styles.value : styles.placeholder}>{shown ?? placeholder}</Text>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>

      {Platform.OS === 'ios' && open && start && (
        <DateTimePicker
          value={start}
          mode="date"
          display="inline"
          locale={locale === 'fr' ? 'fr-CA' : 'en-CA'}
          accentColor={theme.color.accent}
          themeVariant="light"
          onValueChange={(_event, date) => {
            pick(date);
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}

      {onClear && value !== '' && (
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8} style={styles.clear}>
          <Text style={styles.clearText}>{clearLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldOpen: { borderColor: theme.color.accent },
  value: { fontSize: 16, color: theme.color.body },
  placeholder: { fontSize: 16, color: theme.color.muted },
  chevron: { fontSize: 14, color: theme.color.muted },
  clear: { alignSelf: 'flex-start', paddingVertical: theme.space.xs, paddingHorizontal: theme.space.xs },
  clearText: { fontSize: 14, fontWeight: '600', color: theme.color.heading },
});
