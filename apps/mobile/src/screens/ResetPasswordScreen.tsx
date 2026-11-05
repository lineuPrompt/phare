import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { apiPostPublic, messageKeyFor } from '../lib/api';
import { setAuthHold } from '../lib/authHold';
import { authProblem, cleanCode, emailProblem, newPasswordProblem } from '../lib/signUp';
import { authStyles as styles } from '../components/authStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Reset a forgotten password, in the app (S1, 2026-11-05).
 *
 * 1. POST /api/auth/forgot-password: the route the web uses, rate-limited, and
 *    silent about whether the address has an account.
 * 2. The code from that email (verifyOtp, type 'recovery') signs the person
 *    in; the new password is set right then (updateUser), while the gate is
 *    held so this screen can still say if that failed.
 */
export default function ResetPasswordScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** The code worked (signed in) but the new password didn't save yet. */
  const [verified, setVerified] = useState(false);

  const request = async () => {
    if (emailProblem(email)) {
      setErrorKey('signUp.problems.emailInvalid');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await apiPostPublic('/api/auth/forgot-password', { email: email.trim(), locale });
      setStep('code');
    } catch (err) {
      console.error('Reset request error:', err);
      setErrorKey(messageKeyFor(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const token = cleanCode(code);
    if (!token) {
      setErrorKey('signUp.errors.codeInvalid');
      return;
    }
    if (newPasswordProblem(password)) {
      setErrorKey('signUp.problems.passwordShort');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    setAuthHold(true);
    let release = true;
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
      if (error || !data.session) {
        console.error('Reset code error:', error);
        setErrorKey(`signUp.errors.${authProblem(error, 'verify')}`);
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) {
        console.error('New password error:', updateErr);
        // Signed in by the code, but the password is unchanged: say so and
        // stay here so it can be tried again, instead of entering the app as
        // if it had worked.
        setErrorKey(`signUp.errors.${authProblem(updateErr, 'signUp')}`);
        setVerified(true);
        release = false;
        return;
      }
    } catch (err) {
      console.error('Reset threw:', err);
      setErrorKey('signUp.errors.offline');
    } finally {
      setBusy(false);
      if (release) setAuthHold(false);
    }
  };

  // After a failed updateUser the person is signed in but held here; retrying
  // only needs the new password.
  const retryPassword = async () => {
    if (newPasswordProblem(password)) {
      setErrorKey('signUp.problems.passwordShort');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        console.error('New password error:', error);
        setErrorKey(`signUp.errors.${authProblem(error, 'signUp')}`);
        return;
      }
      setAuthHold(false);
    } catch (err) {
      console.error('New password threw:', err);
      setErrorKey('signUp.errors.offline');
    } finally {
      setBusy(false);
    }
  };

  const onSubmitCode = () => (verified ? retryPassword() : reset());

  const leave = async () => {
    if (verified) {
      // Signed in by the code with the password unchanged: leaving signs out,
      // so nobody is left in a session they didn't sign in to.
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Sign-out after a failed reset error:', error);
        setErrorKey('account.signOutFailed');
        return;
      }
      setVerified(false);
      setAuthHold(false);
    }
    if (step === 'code' && !verified) {
      setStep('email');
      setErrorKey(null);
      return;
    }
    onBack();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => void leave()} style={styles.back} hitSlop={8} disabled={busy}>
            <Text style={styles.link}>‹ {t('signUp.back')}</Text>
          </Pressable>

          <Text style={styles.title}>{t('reset.title')}</Text>
          <Text style={styles.subtitle}>
            {step === 'email' ? t('reset.subtitle') : t('reset.codeSent', { email: email.trim() })}
          </Text>

          {errorKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(errorKey)}</Text>
            </View>
          )}

          {step === 'email' ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>{t('signIn.emailLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(v) => { setEmail(v); setErrorKey(null); }}
                  placeholder={t('signIn.emailPlaceholder')}
                  placeholderTextColor={theme.color.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  inputMode="email"
                  editable={!busy}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={() => void request()}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('reset.send')}</Text>}
              </Pressable>
            </>
          ) : (
            <>
              {!verified && (
                <View style={styles.field}>
                  <Text style={styles.label}>{t('signUp.code')}</Text>
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={(v) => { setCode(v); setErrorKey(null); }}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={12}
                    editable={!busy}
                  />
                </View>
              )}
              <View style={styles.field}>
                <Text style={styles.label}>{t('reset.newPassword')}</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={(v) => { setPassword(v); setErrorKey(null); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  secureTextEntry
                  editable={!busy}
                />
                <Text style={styles.hint}>{t('signUp.passwordHint')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={() => void onSubmitCode()}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('reset.save')}</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
