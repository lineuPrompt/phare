import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MANUAL_ENTRY_DESCRIPTION_MAX_CHARS } from '@phare/core';
import { apiDelete, apiGet, apiPatch, apiPost, messageKeyFor } from '../lib/api';
import {
  buildCreateBody,
  buildPatchBody,
  cadenceKey,
  cadencesFor,
  draftForLine,
  draftForNew,
  loadRecurring,
  recurringProblemKey,
  willApplyFromDate,
  type RecurringData,
  type RecurringDraft,
  type RecurringLine,
  type RecurringType,
} from '../lib/recurring';
import { emitEntrySaved } from '../lib/entryEvents';
import Chip from '../components/Chip';
import { formStyles as styles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Edit a recurring line, or add one (standalone S4) — the web Recurring
 * page's editor, through the same routes.
 *
 * When the amount, frequency or date changes on a line that already has a
 * date, the server keeps the past as it was and applies the change from a
 * date: the screen asks "Applies from" (default the 1st of next month; never
 * before today). A description, category or account fix just edits in place.
 */
export default function RecurringEditScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; type?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const newType: RecurringType | null =
    params.type === 'income' || params.type === 'expense' || params.type === 'transfer' ? params.type : null;

  const [data, setData] = useState<RecurringData | null>(null);
  const [line, setLine] = useState<RecurringLine | null>(null);
  const [draft, setDraft] = useState<RecurringDraft | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      return await loadRecurring(apiGet);
    } catch (err) {
      console.error('Recurring editor load error:', err);
      setMessageKey(messageKeyFor(err));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await load();
      if (cancelled || !loaded) return;
      setData(loaded);
      if (id) {
        const found = loaded.lines.find((l) => l.id === id) ?? null;
        if (!found) {
          setMessageKey('recurring.editor.notFound');
          return;
        }
        setLine(found);
        setDraft(draftForLine(found, loaded.today));
      } else if (newType) {
        setDraft(draftForNew(newType, loaded));
      } else {
        setMessageKey('recurring.editor.notFound');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, id, newType]);

  const close = () => router.back();
  const update = (patch: Partial<RecurringDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setMessageKey(null);
    setConfirmingDelete(false);
  };

  const save = async () => {
    if (!draft || !data) return;
    const built = line ? buildPatchBody(line, draft, data.today) : buildCreateBody(draft);
    if (!built.ok) {
      setMessageKey(recurringProblemKey(built.problem));
      return;
    }
    setBusy('saving');
    setMessageKey(null);
    try {
      if (line) await apiPatch(`/api/recurring/${encodeURIComponent(line.id)}`, built.body);
      else await apiPost('/api/recurring', built.body);
      emitEntrySaved();
      close();
    } catch (err) {
      console.error('Recurring save error:', err);
      setMessageKey(messageKeyFor(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!line) return;
    setBusy('deleting');
    setMessageKey(null);
    try {
      const { status } = await apiDelete(`/api/recurring/${encodeURIComponent(line.id)}`, {});
      if (status !== 200) throw new Error(`delete answered ${status}`);
      emitEntrySaved();
      close();
    } catch (err) {
      console.error('Recurring delete error:', err);
      setMessageKey(messageKeyFor(err));
      setConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  };

  const type = line?.type ?? newType;
  const title = line ? t('recurring.editor.titleEdit')
    : type === 'income' ? t('recurring.new.income')
    : type === 'transfer' ? t('recurring.new.transfer')
    : t('recurring.new.expense');

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  if (!data || !draft || !type) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          {messageKey ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey)}</Text>
            </View>
          ) : (
            <ActivityIndicator color={theme.color.heading} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const asksFrom = line !== null && willApplyFromDate(line, draft);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}

          <Text style={styles.label}>{t('recurring.editor.description')}</Text>
          {/* No maxLength: too long is refused, visibly, never cut. */}
          <TextInput
            style={styles.input}
            value={draft.description}
            onChangeText={(description) => update({ description })}
            accessibilityLabel={t('recurring.editor.description')}
          />

          <Text style={styles.label}>{t('recurring.editor.amount')}</Text>
          <TextInput
            style={styles.input}
            value={draft.amount}
            onChangeText={(amount) => update({ amount })}
            keyboardType="decimal-pad"
            accessibilityLabel={t('recurring.editor.amount')}
          />

          <Text style={styles.label}>{t('recurring.editor.cadence')}</Text>
          <View style={styles.chips}>
            {cadencesFor(type).map((c) => (
              <Chip key={c} label={t(cadenceKey(c))} selected={draft.cadence === c} onPress={() => update({ cadence: c })} />
            ))}
          </View>

          <Text style={styles.label}>{t('recurring.editor.date')}</Text>
          <TextInput
            style={styles.input}
            value={draft.anchorDate}
            onChangeText={(anchorDate) => update({ anchorDate })}
            placeholder="2026-11-01"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            accessibilityLabel={t('recurring.editor.date')}
          />
          <Text style={styles.hint}>{t('recurring.editor.dateHint')}</Text>

          {draft.cadence === 'semimonthly' && (
            <>
              <Text style={styles.label}>{t('recurring.editor.secondDay')}</Text>
              <TextInput
                style={styles.input}
                value={draft.secondDay}
                onChangeText={(secondDay) => update({ secondDay })}
                keyboardType="number-pad"
                accessibilityLabel={t('recurring.editor.secondDay')}
              />
            </>
          )}

          {type === 'transfer' ? (
            <>
              <Text style={styles.label}>{t('recurring.editor.goal')}</Text>
              <View style={styles.chips}>
                {data.goalAccounts.map((g) => (
                  <Chip key={g.id} label={g.name} selected={draft.destinationId === g.id} onPress={() => update({ destinationId: g.id })} />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t('recurring.editor.account')}</Text>
              <View style={styles.chips}>
                {data.accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={draft.accountId === a.id} onPress={() => update({ accountId: a.id })} />
                ))}
              </View>
              {type === 'expense' && (
                <>
                  <Text style={styles.label}>{t('recurring.editor.category')}</Text>
                  <View style={styles.chips}>
                    {data.categories.map((c) => (
                      <Chip key={c.id} label={c.name} selected={draft.categoryId === c.id} onPress={() => update({ categoryId: c.id })} />
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {asksFrom && (
            <>
              <Text style={styles.label}>{t('recurring.editor.appliesFrom')}</Text>
              <TextInput
                style={styles.input}
                value={draft.effectiveFrom}
                onChangeText={(effectiveFrom) => update({ effectiveFrom })}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                accessibilityLabel={t('recurring.editor.appliesFrom')}
              />
              <Text style={styles.hint}>{t('recurring.editor.appliesFromHint')}</Text>
            </>
          )}

          {messageKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey, { max: MANUAL_ENTRY_DESCRIPTION_MAX_CHARS })}</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={busy !== null}
            style={({ pressed }) => [styles.button, (pressed || busy !== null) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{busy === 'saving' ? t('recurring.editor.saving') : t('recurring.editor.save')}</Text>
          </Pressable>

          {line && (confirmingDelete ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t('recurring.editor.deleteConfirm')}</Text>
              <Pressable accessibilityRole="button" onPress={() => void remove()} disabled={busy !== null} hitSlop={8}>
                <Text style={styles.retry}>{busy === 'deleting' ? t('recurring.editor.deleting') : t('recurring.editor.confirmDelete')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(true)} hitSlop={8} style={{ alignSelf: 'center', marginTop: theme.space.md }}>
              <Text style={[styles.close, { color: theme.color.danger }]}>{t('recurring.editor.delete')}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
