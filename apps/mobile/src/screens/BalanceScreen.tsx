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
import { useRouter } from 'expo-router';
import { formatCADLocale } from '@phare/core';
import { apiGet, apiPost, messageKeyFor } from '../lib/api';
import { balanceProblemKey, loadBalanceForm, planBalance, type BalanceForm } from '../lib/accounts';
import { emitEntrySaved } from '../lib/entryEvents';
import { formatDayLong } from '../lib/timelineView';
import Chip from '../components/Chip';
import { formStyles as styles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The chequing balance on a known date — the anchor the Timeline and the Plan
 * are walked from (POST /api/anchors, the web's AnchorForm route). Standalone
 * S3: this used to be "set it on phare.money".
 *
 * Saving the same date again replaces that date's balance (the route upserts
 * on account + date); a later date starts the walk from there. Earlier
 * anchors are never touched — the route has no way to, and neither does this.
 *
 * After a 200 it tells the tabs to refetch (emitEntrySaved), so Home and the
 * Timeline start from the new balance without a pull.
 */
export default function BalanceScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [form, setForm] = useState<BalanceForm | null>(null);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchForm = useCallback(async (): Promise<{ form: BalanceForm } | { errorKey: string }> => {
    try {
      return { form: await loadBalanceForm(apiGet) };
    } catch (err) {
      console.error('Balance form load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const applyForm = useCallback((outcome: { form: BalanceForm } | { errorKey: string }) => {
    if ('form' in outcome) {
      setForm(outcome.form);
      setLoadErrorKey(null);
      setDate((d) => d || outcome.form.today);
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

  const save = async () => {
    if (!form?.chequing) return;
    const planned = planBalance({ amount, date }, form.chequing.id, form.today);
    if (!planned.ok) {
      setMessageKey(balanceProblemKey(planned.problem));
      return;
    }
    setSaving(true);
    setMessageKey(null);
    setSaved(false);
    try {
      await apiPost('/api/anchors', planned.body);
      emitEntrySaved();
      setSaved(true);
      setAmount('');
      // "Last set" is re-read from the server, not assembled here.
      applyForm(await fetchForm());
    } catch (err) {
      console.error('Balance save error:', err);
      setMessageKey(messageKeyFor(err));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{t('balance.title')}</Text>
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
              <Pressable accessibilityRole="button" onPress={async () => applyForm(await fetchForm())} hitSlop={8}>
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

  if (!form.chequing) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          <Text style={styles.intro}>{t('balance.noChequing')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace({ pathname: '/account-new', params: { type: 'chequing' } })}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{t('balance.addChequing')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}
          <Text style={styles.intro}>{t('balance.intro')}</Text>
          <Text style={styles.hint}>
            {form.latest
              ? t('balance.last', {
                  amount: formatCADLocale(form.latest.balance, locale),
                  date: formatDayLong(form.latest.date, locale),
                })
              : t('balance.none')}
          </Text>

          <Text style={styles.label}>{t('balance.amount')}</Text>
          {/* numbers-and-punctuation, not decimal-pad: the iOS decimal pad has
              no minus key, and an overdrawn balance is a real one. */}
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setMessageKey(null);
              setSaved(false);
            }}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            accessibilityLabel={t('balance.amount')}
          />
          <Text style={styles.hint}>{t('balance.amountHint')}</Text>

          <Text style={styles.label}>{t('balance.date')}</Text>
          <View style={styles.chips}>
            <Chip label={t('balance.today')} selected={date === form.today} onPress={() => setDate(form.today)} />
          </View>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={(value) => {
              setDate(value);
              setMessageKey(null);
              setSaved(false);
            }}
            placeholder={t('balance.datePlaceholder')}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            accessibilityLabel={t('balance.date')}
          />

          {messageKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey)}</Text>
            </View>
          )}
          {saved && <Text style={styles.saved}>{t('balance.saved')}</Text>}

          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={saving}
            style={({ pressed }) => [styles.button, (pressed || saving) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{saving ? t('balance.saving') : t('balance.save')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
