import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiGet, messageKeyFor } from '../lib/api';
import { accountTypeKey, loadAccounts, type Account } from '../lib/accounts';
import { onEntrySaved } from '../lib/entryEvents';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The household's accounts on the Account tab: each one's name and type,
 * "Update balance" on chequing, and "Add an account". Standalone S3.
 *
 * No balances are listed: a goal account's balance is the server's
 * computeGoalBalance and a card's is its cycle, both shown where they belong
 * (savings goals in S8, Cards). Listing a figure here would need a route that
 * computes it, not arithmetic in the app.
 */
export default function AccountsSection() {
  const { t } = useI18n();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const fetchAccounts = useCallback(async (): Promise<{ accounts: Account[] } | { errorKey: string }> => {
    try {
      return { accounts: await loadAccounts(apiGet) };
    } catch (err) {
      console.error('Accounts load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: { accounts: Account[] } | { errorKey: string }) => {
    if ('accounts' in outcome) {
      setAccounts(outcome.accounts);
      setErrorKey(null);
    } else {
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const outcome = await fetchAccounts();
      if (!cancelled) apply(outcome);
    };
    void load();
    // A new account or balance saved in a modal: refetch so it is listed.
    const unsubscribe = onEntrySaved(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetchAccounts, apply]);

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('accounts.title')}</Text>

      {errorKey && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t(errorKey)}</Text>
          <Pressable accessibilityRole="button" onPress={async () => apply(await fetchAccounts())} hitSlop={8}>
            <Text style={styles.retry}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}

      {!accounts && !errorKey && <ActivityIndicator color={theme.color.heading} />}

      {accounts && accounts.length === 0 && <Text style={styles.muted}>{t('accounts.empty')}</Text>}

      {accounts?.map((account) => (
        <View key={account.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
            <Text style={styles.muted}>{t(accountTypeKey(account.type))}</Text>
          </View>
          {account.type === 'chequing' && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/balance')} hitSlop={8}>
              <Text style={styles.link}>{t('accounts.updateBalance')}</Text>
            </Pressable>
          )}
        </View>
      ))}

      {accounts && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/account-new')}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{t('accounts.add')}</Text>
        </Pressable>
      )}
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
    gap: theme.space.sm,
  },
  heading: { fontSize: 17, fontWeight: '700', color: theme.color.heading },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, color: theme.color.body },
  muted: { fontSize: 13, color: theme.color.muted },
  link: { fontSize: 14, fontWeight: '700', color: theme.color.accent },
  button: {
    borderWidth: 1.5,
    borderColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: theme.space.xs,
  },
  pressed: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
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
