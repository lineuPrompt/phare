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
import { apiDelete, apiGet, apiPatch } from '../lib/api';
import { loadEntryForm, type EntryCategory } from '../lib/quickEntry';
import {
  buildEditBody,
  editErrorKey,
  editProblemKey,
  entryPath,
  type EditableKind,
  type EditDraft,
} from '../lib/entryEdit';
import { emitEntrySaved } from '../lib/entryEvents';
import Chip from '../components/Chip';
import { formStyles as styles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/** What the Timeline row hands over (route params are strings). */
export type EditEntryParams = {
  id?: string;
  kind?: string;
  type?: string;
  date?: string;
  description?: string;
  amount?: string;
  recurring?: string;
};

/**
 * Edit or delete one Timeline entry (entryEdit.ts says which route and why).
 *
 * After the server answers 200, every tab refetches (emitEntrySaved) and the
 * modal closes: the Timeline shows the entry as the SERVER now has it, never
 * as this form last held it.
 */
export default function EditEntryScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<EditEntryParams>();

  const kind: EditableKind | null = params.kind === 'transfer' ? 'transfer' : params.kind === 'entry' ? 'entry' : null;
  const entryType = params.type === 'income' || params.type === 'expense' || params.type === 'transfer' ? params.type : null;
  const isRecurring = params.recurring === '1';

  const [draft, setDraft] = useState<EditDraft>({
    date: params.date ?? '',
    description: params.description ?? '',
    amount: params.amount ?? '',
    categoryId: '',
  });
  const [categories, setCategories] = useState<EntryCategory[] | null>(null);
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);

  // Categories only matter for an expense; a failure to load them leaves the
  // category as it is ("Keep current") rather than blocking the edit.
  const fetchCategories = useCallback(async () => {
    if (entryType !== 'expense') return [];
    try {
      return (await loadEntryForm(apiGet)).categories;
    } catch (err) {
      console.error('Edit entry categories load error:', err);
      return [];
    }
  }, [entryType]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchCategories();
      if (!cancelled) setCategories(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCategories]);

  const update = (patch: Partial<EditDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessageKey(null);
  };

  const close = () => router.back();

  const save = async () => {
    if (!kind || !entryType || !params.id) return;
    const built = buildEditBody(kind, entryType, draft);
    if (!built.ok) {
      setMessageKey(editProblemKey(built.problem));
      return;
    }
    setBusy('saving');
    setMessageKey(null);
    try {
      await apiPatch(entryPath(kind, params.id), built.body);
      emitEntrySaved();
      close();
    } catch (err) {
      console.error('Edit entry save error:', err);
      setMessageKey(editErrorKey(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!kind || !params.id) return;
    setBusy('deleting');
    setMessageKey(null);
    try {
      await apiDelete(entryPath(kind, params.id), {});
      emitEntrySaved();
      close();
    } catch (err) {
      console.error('Edit entry delete error:', err);
      setMessageKey(editErrorKey(err));
      setConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{kind === 'transfer' ? t('edit.titleTransfer') : t('edit.title')}</Text>
      <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  // A link with no editable entry behind it (an old or hand-typed URL).
  if (!kind || !entryType || !params.id) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('edit.errors.gone')}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const deleteQuestion = isRecurring
    ? t('edit.deleteOccurrenceConfirm')
    : kind === 'transfer'
      ? t('edit.deleteTransferConfirm')
      : t('edit.deleteEntryConfirm');

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}

          {isRecurring && <Text style={styles.intro}>{t('edit.detachHint')}</Text>}
          {kind === 'transfer' && <Text style={styles.intro}>{t('edit.transferHint')}</Text>}

          <Text style={styles.label}>{t('entry.date')}</Text>
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
          {/* No maxLength: too long is refused, visibly, never cut. */}
          <TextInput
            style={styles.input}
            value={draft.description}
            onChangeText={(description) => update({ description })}
            accessibilityLabel={t('entry.description')}
          />

          {entryType === 'expense' && (
            <>
              <Text style={styles.label}>{t('entry.category')}</Text>
              {categories === null ? (
                <ActivityIndicator color={theme.color.heading} />
              ) : (
                <View style={styles.chips}>
                  <Chip label={t('edit.categoryUnchanged')} selected={draft.categoryId === ''} onPress={() => update({ categoryId: '' })} />
                  {categories.map((c) => (
                    <Chip key={c.id} label={c.name} selected={draft.categoryId === c.id} onPress={() => update({ categoryId: c.id })} />
                  ))}
                </View>
              )}
            </>
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
              <Text style={styles.errorText}>{t(messageKey, { max: MANUAL_ENTRY_DESCRIPTION_MAX_CHARS })}</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={busy !== null}
            style={({ pressed }) => [styles.button, (pressed || busy !== null) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{busy === 'saving' ? t('edit.saving') : t('edit.save')}</Text>
          </Pressable>

          {confirmingDelete ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{deleteQuestion}</Text>
              <Pressable accessibilityRole="button" onPress={() => void remove()} disabled={busy !== null} hitSlop={8}>
                <Text style={styles.retry}>{busy === 'deleting' ? t('edit.deleting') : t('edit.confirmDelete')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(false)} hitSlop={8}>
                <Text style={styles.close}>{t('edit.cancel')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmingDelete(true)}
              disabled={busy !== null}
              style={({ pressed }) => [styles.secondaryButton, { borderColor: theme.color.danger }, pressed && styles.buttonPressed]}
            >
              <Text style={[styles.secondaryButtonText, { color: theme.color.danger }]}>{t('edit.delete')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
