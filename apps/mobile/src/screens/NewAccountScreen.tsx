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
import { acceptsOpeningBalance } from '@phare/core';
import { apiGet, apiPatch, apiPost, messageKeyFor } from '../lib/api';
import {
  accountTypeKey,
  addableTypes,
  createAccount,
  loadAccounts,
  newAccountProblemKey,
  planNewAccount,
  setOpeningBalance,
  type Account,
  type AddableAccountType,
} from '../lib/accounts';
import { emitEntrySaved } from '../lib/entryEvents';
import Chip from '../components/Chip';
import { formStyles as styles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Add an account: chequing (while there is none), a credit card, or a
 * savings / TFSA / RRSP account with an optional starting balance. Standalone
 * S3 — before it, every "no account" state said "add one on phare.money".
 *
 * `?type=` preselects a type (the Cards tab sends credit_card; the balance
 * screen sends chequing). A preselection the household cannot use (a second
 * chequing) is ignored.
 *
 * Card statement and payment days are not asked here: they are set with the
 * card's goal and budgets (standalone S5). Until then a card's cycle is the
 * calendar month, exactly as on the web for a card with no close day.
 */
export default function NewAccountScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();

  const [types, setTypes] = useState<AddableAccountType[] | null>(null);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [type, setType] = useState<AddableAccountType | null>(null);
  const [name, setName] = useState('');
  const [openingBalance, setOpeningBalanceText] = useState('');
  const [saving, setSaving] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  /** Set when the account exists but its starting balance did not save. */
  const [pendingBalance, setPendingBalance] = useState<{ account: Account; amount: number } | null>(null);

  const fetchTypes = useCallback(async (): Promise<{ types: AddableAccountType[] } | { errorKey: string }> => {
    try {
      return { types: addableTypes(await loadAccounts(apiGet)) };
    } catch (err) {
      console.error('New account load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const applyTypes = useCallback(
    (outcome: { types: AddableAccountType[] } | { errorKey: string }) => {
      if ('types' in outcome) {
        setTypes(outcome.types);
        setLoadErrorKey(null);
        const wanted = outcome.types.find((candidate) => candidate === params.type);
        setType((current) => current ?? wanted ?? outcome.types[0] ?? null);
      } else {
        setLoadErrorKey(outcome.errorKey);
      }
    },
    [params.type]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchTypes();
      if (!cancelled) applyTypes(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTypes, applyTypes]);

  const save = async () => {
    if (!type) return;
    const planned = planNewAccount({ name, type, openingBalance });
    if (!planned.ok) {
      setMessageKey(newAccountProblemKey(planned.problem));
      return;
    }
    setSaving(true);
    setMessageKey(null);
    try {
      const outcome = await createAccount(apiPost, apiPatch, planned.plan);
      emitEntrySaved();
      if (outcome.kind === 'created') {
        router.back();
        return;
      }
      console.error('New account opening balance error:', outcome.error);
      setPendingBalance({ account: outcome.account, amount: planned.plan.openingBalance as number });
      setMessageKey(messageKeyFor(outcome.error));
    } catch (err) {
      console.error('New account save error:', err);
      setMessageKey(messageKeyFor(err));
    } finally {
      setSaving(false);
    }
  };

  const retryBalance = async () => {
    if (!pendingBalance) return;
    setSaving(true);
    try {
      await setOpeningBalance(apiPatch, pendingBalance.account.id, pendingBalance.amount);
      emitEntrySaved();
      router.back();
    } catch (err) {
      console.error('Opening balance retry error:', err);
      setMessageKey(messageKeyFor(err));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{t('accounts.new.title')}</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  if (!types || !type) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          {loadErrorKey ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(loadErrorKey)}</Text>
              <Pressable accessibilityRole="button" onPress={async () => applyTypes(await fetchTypes())} hitSlop={8}>
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

  // The account exists; only its starting balance is outstanding.
  if (pendingBalance) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              {t('accounts.new.balanceFailed', { name: pendingBalance.account.name })}
            </Text>
            {messageKey && <Text style={styles.errorText}>{t(messageKey)}</Text>}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void retryBalance()}
            disabled={saving}
            style={({ pressed }) => [styles.button, (pressed || saving) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{t('accounts.new.retryBalance')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.secondaryButtonText}>{t('accounts.new.done')}</Text>
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

          <Text style={styles.label}>{t('accounts.new.type')}</Text>
          <View style={styles.chips}>
            {types.map((candidate) => (
              <Chip
                key={candidate}
                label={t(accountTypeKey(candidate))}
                selected={type === candidate}
                onPress={() => {
                  setType(candidate);
                  setMessageKey(null);
                }}
              />
            ))}
          </View>

          <Text style={styles.label}>{t('accounts.new.name')}</Text>
          {/* No maxLength: a cap would cut a pasted name silently. */}
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(value) => {
              setName(value);
              setMessageKey(null);
            }}
            placeholder={t('accounts.new.namePlaceholder')}
            accessibilityLabel={t('accounts.new.name')}
          />

          {acceptsOpeningBalance(type) && (
            <>
              <Text style={styles.label}>{t('accounts.new.openingBalance')}</Text>
              <TextInput
                style={styles.input}
                value={openingBalance}
                onChangeText={(value) => {
                  setOpeningBalanceText(value);
                  setMessageKey(null);
                }}
                keyboardType="decimal-pad"
                accessibilityLabel={t('accounts.new.openingBalance')}
              />
              <Text style={styles.hint}>{t('accounts.new.openingBalanceHint')}</Text>
            </>
          )}

          {messageKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey)}</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={saving}
            style={({ pressed }) => [styles.button, (pressed || saving) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{saving ? t('accounts.new.saving') : t('accounts.new.save')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
