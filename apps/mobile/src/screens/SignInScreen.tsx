import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { authStyles as styles } from '../components/authStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

// The app icon, scaled down (288 px, ~90 KB) so the sign-in screen opens on
// the same lighthouse the home screen showed a moment before.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro's static image asset form
const LOGO = require('../../assets/logo.png') as number;

/**
 * Password sign-in — the same call the web app makes.
 *
 * src/app/[locale]/signin/page.tsx is
 * `supabase.auth.signInWithPassword({ email, password })` and nothing else: no
 * custom endpoint, no server action. This is that call, so a household's
 * existing credentials work here with no migration and no second account.
 *
 * Creating an account and resetting a password happen in the app too
 * (2026-11-05): SignUpScreen and ResetPasswordScreen, reached from the two
 * links below.
 *
 * THE ERROR IS NOT THE SERVER'S. Supabase returns English strings written for
 * developers ("Invalid login credentials"); this app is bilingual, so the
 * AuthError is classified and the copy comes from the catalogue. It also
 * deliberately does not distinguish "no such account" from "wrong password" —
 * the web reset flow makes the same choice, and saying which one is wrong
 * confirms whether an address has an account.
 */
export default function SignInScreen({ onCreateAccount, onForgot }: { onCreateAccount: () => void; onForgot: () => void }) {
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
          <View style={styles.brand}>
            <Image source={LOGO} style={styles.logo} alt="" accessibilityIgnoresInvertColors />
            <Text style={styles.wordmark}>Phare</Text>
          </View>
          <Text style={[styles.title, styles.centred]}>{t('signIn.title')}</Text>
          <Text style={[styles.subtitle, styles.centred]}>{t('signIn.subtitle')}</Text>

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

          <View style={[styles.links, styles.linksCentred]}>
            <Pressable accessibilityRole="button" onPress={onForgot} hitSlop={8} disabled={submitting}>
              <Text style={styles.link}>{t('signIn.forgot')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onCreateAccount} hitSlop={8} disabled={submitting}>
              <Text style={styles.link}>{t('signIn.create')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
