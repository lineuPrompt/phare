import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiGet, apiPost, messageKeyFor } from '../lib/api';
import { acceptCurrentTerms, acceptErrorKeyFor, loadHouseholdState, type HouseholdState } from '../lib/householdGate';
import { supabase } from '../lib/supabase';
import OnboardingScreen from '../screens/OnboardingScreen';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The second gate, inside AuthGate: terms, then a plan, then the household's
 * content. No plan means onboarding in place of the tabs.
 *
 * Rendered in place like AuthGate, for the same reason — no redirect to race.
 * Every blocked state offers sign-out, because "sign in again" is the only
 * way forward from the terms block and a dead end with no exit is worse.
 */
export default function HouseholdGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<HouseholdState | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [signOutFailed, setSignOutFailed] = useState(false);

  // Global sign-out that fails (offline) leaves the device signed in and
  // says nothing unless told to. See AccountScreen.
  const signOut = async () => {
    setSignOutFailed(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign-out error:', error);
      setSignOutFailed(true);
    }
  };

  const fetchState = useCallback(async (): Promise<{ state: HouseholdState } | { errorKey: string }> => {
    try {
      return { state: await loadHouseholdState(apiGet) };
    } catch (err) {
      console.error('Household gate error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: { state: HouseholdState } | { errorKey: string }) => {
    if ('state' in outcome) {
      setState(outcome.state);
      setErrorKey(null);
    } else {
      setState(null);
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchState();
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchState, apply]);

  const retry = async () => apply(await fetchState());

  // Updated terms, accepted in the app: the web's own call, then the gate asks
  // the server again rather than assuming it stuck.
  const [accepting, setAccepting] = useState(false);
  const [acceptErrorKey, setAcceptErrorKey] = useState<string | null>(null);
  const accept = async () => {
    setAccepting(true);
    setAcceptErrorKey(null);
    try {
      await acceptCurrentTerms(apiPost);
      await retry();
    } catch (err) {
      console.error('Accepting the terms failed:', err);
      setAcceptErrorKey(acceptErrorKeyFor(err));
    } finally {
      setAccepting(false);
    }
  };

  if (state?.kind === 'ready') return <>{children}</>;

  // No plan yet: onboarding replaces the tabs. Finishing it (or asking to
  // check again) re-asks the server rather than assuming the save stuck.
  if (state?.kind === 'needsPlan') return <OnboardingScreen onFinished={() => void retry()} />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        {state === null && errorKey === null && <ActivityIndicator color={theme.color.heading} />}

        {errorKey && (
          <>
            <Text style={styles.body}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void retry()} hitSlop={8}>
              <Text style={styles.action}>{t('common.retry')}</Text>
            </Pressable>
          </>
        )}

        {/* Accepted here since 2026-11-05: the Terms and the Privacy Policy
            are readable in the app (from @phare/core, no price, no link out),
            and the acceptance is the web's own call. */}
        {state?.kind === 'termsOutdated' && (
          <>
            <Text style={styles.body}>{t('terms.updated')}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push('/terms')} hitSlop={8}>
              <Text style={styles.action}>{t('terms.readTerms')}</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')} hitSlop={8}>
              <Text style={styles.action}>{t('terms.readPrivacy')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void accept()}
              disabled={accepting}
              style={[styles.button, accepting && styles.buttonDisabled]}
            >
              {accepting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('terms.accept')}</Text>}
            </Pressable>
            {acceptErrorKey && <Text style={styles.error}>{t(acceptErrorKey)}</Text>}
          </>
        )}

        {(errorKey || state?.kind === 'termsOutdated') && (
          <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={8}>
            <Text style={styles.signOut}>{t('common.signOut')}</Text>
          </Pressable>
        )}
        {signOutFailed && <Text style={styles.error}>{t('account.signOutFailed')}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
    gap: theme.space.lg,
  },
  body: { fontSize: 17, lineHeight: 26, color: theme.color.body, textAlign: 'center' },
  action: { fontSize: 15, fontWeight: '700', color: theme.color.heading },
  signOut: { fontSize: 15, color: theme.color.muted },
  error: { fontSize: 14, color: theme.color.danger, textAlign: 'center' },
  button: {
    alignSelf: 'stretch',
    backgroundColor: theme.color.heading,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
