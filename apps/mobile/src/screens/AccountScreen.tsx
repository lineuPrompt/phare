import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/useSession';
import { useI18n } from '../i18n';
import { theme } from '../theme';
import DeleteAccountSection from '../components/DeleteAccountSection';

/**
 * The Account tab: who is signed in, the way out, and account deletion.
 *
 * SIGN-OUT ERRORS ARE SHOWN, NOT SWALLOWED. supabase-js resolves signOut()
 * with an { error } rather than rejecting, and with the default 'global'
 * scope a failed revoke (offline, 5xx) returns BEFORE the local session is
 * removed — auth-js 2.110 GoTrueClient._signOut. The device stays signed in.
 * The old header link ignored the result, so an offline tap did nothing and
 * said nothing. Here the person is told, and can try again.
 */
export default function AccountScreen() {
  const { t } = useI18n();
  const session = useSession();
  const email = session.status === 'signedIn' ? session.session.user.email ?? null : null;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign-out error:', error);
      setSignOutFailed(true);
    }
    setSigningOut(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('account.title')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('account.emailLabel')}</Text>
          {/* An account with no email on the session is not normal — say so
              rather than render an empty line that reads as a layout bug. */}
          <Text style={styles.value}>{email ?? t('account.emailUnknown')}</Text>
        </View>

        {signOutFailed && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('account.signOutFailed')}</Text>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => void signOut()}
          disabled={signingOut}
          style={({ pressed }) => [styles.button, (pressed || signingOut) && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>
            {signingOut ? t('account.signingOut') : t('common.signOut')}
          </Text>
        </Pressable>

        {/* Deletion must be doable in the app (App Store 5.1.1(v)). */}
        <DeleteAccountSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.space.md, gap: theme.space.md },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.color.heading,
    paddingHorizontal: theme.space.xs,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  label: { fontSize: 13, color: theme.color.muted },
  value: { fontSize: 16, color: theme.color.body },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: 14 },
  button: {
    borderWidth: 1.5,
    borderColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
});
