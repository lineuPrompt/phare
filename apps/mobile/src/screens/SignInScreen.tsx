import { useState } from 'react';
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
import { AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Password sign-in — the same call the web app makes.
 *
 * src/app/[locale]/signin/page.tsx:106 is
 * `supabase.auth.signInWithPassword({ email, password })` and nothing else: no
 * custom endpoint, no server action. This is that call, so a household's
 * existing credentials work here with no migration and no second account.
 *
 * SIGN-UP AND RESET ARE DELIBERATELY ABSENT. Both exist on the web and both
 * carry obligations this scaffold does not implement — signup must capture
 * legal consent at the same moment (CURRENT_LEGAL_VERSION, /api/legal/accept),
 * and reset goes through an emailed link that Universal Links have to catch.
 * A half-built version of either is worse than a pointer to the website.
 *
 * THE ERROR IS NOT THE SERVER'S. Supabase returns English strings written for
 * developers ("Invalid login credentials"); this app is bilingual, so the
 * AuthError is classified and the copy comes from the catalogue. It also
 * deliberately does not distinguish "no such account" from "wrong password" —
 * the web reset flow makes the same choice, and saying which one is wrong
 * confirms whether an address has an account.
 */
export default function SignInScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorKey(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      // No navigation here. The root layout watches the session and swaps the
      // screen when it appears — routing on this callback as well would race
      // it and could push a duplicate screen.
      if (error) {
        setErrorKey(
          error instanceof AuthError && error.status === undefined
            ? 'signIn.offline'
            : 'signIn.failed'
        );
      }
    } catch {
      setErrorKey('signIn.offline');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('signIn.title')}</Text>
          <Text style={styles.subtitle}>{t('signIn.subtitle')}</Text>

          {errorKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(errorKey)}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>{t('signIn.emailLabel')}</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('signIn.emailPlaceholder')}
              placeholderTextColor={theme.color.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              editable={!submitting}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('signIn.passwordLabel')}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t('signIn.passwordPlaceholder')}
              placeholderTextColor={theme.color.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              secureTextEntry
              editable={!submitting}
              onSubmitEditing={() => canSubmit && handleSubmit()}
              returnKeyType="go"
            />
          </View>

          <Pressable
            accessibilityRole="button"
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>{t('signIn.submit')}</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>{t('signIn.forgotHint')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  flex: { flex: 1 },
  content: { padding: theme.space.lg, gap: theme.space.md },
  title: { fontSize: 28, fontWeight: '700', color: theme.color.heading },
  subtitle: { fontSize: 15, color: theme.color.muted, marginBottom: theme.space.sm },
  field: { gap: theme.space.xs },
  label: { fontSize: 13, fontWeight: '600', color: theme.color.body },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    fontSize: 16,
    color: theme.color.body,
  },
  button: {
    marginTop: theme.space.sm,
    backgroundColor: theme.color.heading,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, color: theme.color.muted, marginTop: theme.space.sm },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: 14 },
});
