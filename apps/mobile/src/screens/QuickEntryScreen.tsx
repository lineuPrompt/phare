import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { addCalendarDays, MANUAL_ENTRY_DESCRIPTION_MAX_CHARS } from '@phare/core';
import { apiGet, apiPost, messageKeyFor } from '../lib/api';
import {
  buildExpenseBody,
  entryErrorKey,
  loadEntryForm,
  problemKey,
  type EntryDraft,
  type EntryForm,
} from '../lib/quickEntry';
import { emitEntrySaved } from '../lib/entryEvents';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Add an expense: money out, one-off, on chequing or a credit card.
 *
 * What it never does, each on purpose:
 *   - show the entry anywhere before the server says 200;
 *   - send a member, a repeat or installments (quickEntry.ts builds the body);
 *   - offer "new category" — creating one is a paid feature on the web, and a
 *     locked control here would be a paywall in the app;
 *   - treat its own checks as final — the server's refusal is what is shown.
 *
 * After a save it stays open with account, category and date kept, so a
 * second receipt is two fields away. "Close" returns to the tab underneath,
 * which has already been told to refetch.
 */
export default function QuickEntryScreen() {
  const { t } = useI18n();
  const router = useRouter();

  const [form, setForm] = useState<EntryForm | null>(null);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>({
    accountId: '', date: '', description: '', categoryId: '', amount: '',
  });
  const [saving, setSaving] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fetching and applying are separate, as on the other screens, so a result
  // that lands after the modal closed is dropped rather than set.
  const fetchForm = useCallback(async (): Promise<{ form: EntryForm } | { errorKey: string }> => {
    try {
      return { form: await loadEntryForm(apiGet) };
    } catch (err) {
      console.error('Quick entry load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const applyForm = useCallback((outcome: { form: EntryForm } | { errorKey: string }) => {
    if ('form' in outcome) {
      const loaded = outcome.form;
      setForm(loaded);
      setLoadErrorKey(null);
      // Defaults only fill what is empty: a retry never overwrites a choice.
      setDraft((d) => ({
        ...d,
        date: d.date || loaded.today,
        accountId: d.accountId || loaded.accounts[0]?.id || '',
      }));
    } else {
      setLoadErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchForm();
      if (!cancelled) applyForm(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchForm, applyForm]);

  const retryLoad = async () => applyForm(await fetchForm());

  const update = (patch: Partial<EntryDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessageKey(null);
    setSaved(false);
  };

  const save = async () => {
    const built = buildExpenseBody(draft);
    if (!built.ok) {
      setMessageKey(problemKey(built.problem));
      return;
    }
    setSaving(true);
    setMessageKey(null);
    setSaved(false);
    try {
      await apiPost('/api/expenses', built.body);
      // Only now: the server has the row.
      emitEntrySaved();
      setSaved(true);
      setDraft((d) => ({ ...d, description: '', amount: '' }));
    } catch (err) {
      console.error('Quick entry save error:', err);
      setMessageKey(entryErrorKey(err));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{t('entry.title')}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  if (!form) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          {loadErrorKey ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(loadErrorKey)}</Text>
              <Pressable accessibilityRole="button" onPress={() => void retryLoad()} hitSlop={8}>
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={theme.color.heading} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const today = form.today;
  const yesterday = addCalendarDays(today, -1);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}

          {form.accounts.length === 0 ? (
            <Text style={styles.empty}>{t('entry.noAccounts')}</Text>
          ) : (
            <>
              <Text style={styles.label}>{t('entry.account')}</Text>
              <View style={styles.chips}>
                {form.accounts.map((a) => (
                  <Chip
                    key={a.id}
                    label={a.name}
                    selected={draft.accountId === a.id}
                    onPress={() => update({ accountId: a.id })}
                  />
                ))}
              </View>

              <Text style={styles.label}>{t('entry.date')}</Text>
              <View style={styles.chips}>
                <Chip label={t('entry.today')} selected={draft.date === today} onPress={() => update({ date: today })} />
                <Chip
                  label={t('entry.yesterday')}
                  selected={draft.date === yesterday}
                  onPress={() => update({ date: yesterday })}
                />
              </View>
              <TextInput
                style={styles.input}
                value={draft.date}
                onChangeText={(date) => update({ date })}
                placeholder={t('entry.datePlaceholder')}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                accessibilityLabel={t('entry.date')}
              />

              <Text style={styles.label}>{t('entry.description')}</Text>
              {/* No maxLength: a length cap on the field would cut a pasted
                  description silently. Too long is refused, visibly, on save. */}
              <TextInput
                style={styles.input}
                value={draft.description}
                onChangeText={(description) => update({ description })}
                accessibilityLabel={t('entry.description')}
              />

              <Text style={styles.label}>{t('entry.category')}</Text>
              {form.categories.length === 0 ? (
                <Text style={styles.hint}>{t('entry.noCategories')}</Text>
              ) : (
                <View style={styles.chips}>
                  {form.categories.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      selected={draft.categoryId === c.id}
                      onPress={() => update({ categoryId: c.id })}
                    />
                  ))}
                </View>
              )}

              <Text style={styles.label}>{t('entry.amount')}</Text>
              <TextInput
                style={styles.input}
                value={draft.amount}
                onChangeText={(amount) => update({ amount })}
                keyboardType="decimal-pad"
                accessibilityLabel={t('entry.amount')}
              />

              {messageKey && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>
                    {t(messageKey, { max: MANUAL_ENTRY_DESCRIPTION_MAX_CHARS })}
                  </Text>
                </View>
              )}
              {saved && <Text style={styles.saved}>{t('entry.saved')}</Text>}

              <Pressable
                accessibilityRole="button"
                onPress={() => void save()}
                disabled={saving}
                style={({ pressed }) => [styles.button, (pressed || saving) && styles.buttonPressed]}
              >
                <Text style={styles.buttonText}>{saving ? t('entry.saving') : t('entry.save')}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  flex: { flex: 1 },
  content: { padding: theme.space.md, gap: theme.space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.space.xs,
    marginBottom: theme.space.sm,
  },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.heading },
  close: { fontSize: 15, color: theme.color.muted },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.muted,
    marginTop: theme.space.sm,
    paddingHorizontal: theme.space.xs,
  },
  hint: { fontSize: 14, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.color.body,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.color.surface,
  },
  chipSelected: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSurface },
  chipText: { fontSize: 14, color: theme.color.muted },
  chipTextSelected: { color: theme.color.heading, fontWeight: '600' },
  empty: { fontSize: 15, lineHeight: 23, color: theme.color.muted, padding: theme.space.md },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
    marginTop: theme.space.sm,
  },
  errorText: { color: theme.color.danger, fontSize: 14 },
  retry: { color: theme.color.danger, fontSize: 14, fontWeight: '700' },
  saved: { color: theme.color.positive, fontSize: 15, fontWeight: '600', marginTop: theme.space.sm },
  button: {
    backgroundColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: '700', color: theme.color.surface },
});
