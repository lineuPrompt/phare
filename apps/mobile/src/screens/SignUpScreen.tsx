import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CURRENT_LEGAL_VERSION } from '@phare/core';
import { supabase } from '../lib/supabase';
import { apiPost } from '../lib/api';
import { setAuthHold } from '../lib/authHold';
import { authProblem, cleanCode, signUpParams, signUpProblem, type SignUpDraft } from '../lib/signUp';
import { authStyles as styles } from '../components/authStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Create an account, in the app (S1, 2026-11-05). The same supabase-js call
 * the web makes (signUp), then the code from the confirmation email
 * (verifyOtp). The code signs the person in; consent is recorded right then
 * (/api/legal/accept, as the web does), and the household gate takes over:
 * onboarding builds the plan.
 *
 * Consent is a box the person ticks, beside the Terms and the Privacy Policy,
 * both readable here (/terms, /privacy), never on a web page.
 */
export default function SignUpScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<SignUpDraft>({ fullName: '', email: '', password: '', consent: false });
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const set = (patch: Partial<SignUpDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrorKey(null);
  };

  const submit = async () => {
    const problem = signUpProblem(draft);
    if (problem) {
      setErrorKey(`signUp.problems.${problem}`);
      return;
    }
    setBusy(true);
    setErrorKey(null);
    try {
      const { error } = await supabase.auth.signUp(signUpParams(draft, locale));
      if (error) {
        console.error('Sign-up error:', error);
        setErrorKey(`signUp.errors.${authProblem(error, 'signUp')}`);
        return;
      }
      setStep('code');
    } catch (err) {
      console.error('Sign-up threw:', err);
      setErrorKey('signUp.errors.offline');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const token = cleanCode(code);
    if (!token) {
      setErrorKey('signUp.errors.codeInvalid');
      return;
    }
    setBusy(true);
    setErrorKey(null);
    // Hold the gate: the code signs the person in, and consent must be
    // recorded before the app replaces this screen.
    setAuthHold(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: draft.email.trim(), token, type: 'signup' });
      if (error || !data.session) {
        console.error('Sign-up code error:', error);
        setErrorKey(`signUp.errors.${authProblem(error, 'verify')}`);
        return;
      }
      try {
        await apiPost('/api/legal/accept', { version: CURRENT_LEGAL_VERSION });
      } catch (err) {
        // Not lost: the household gate finds the terms unaccepted and asks
        // for them in the app. Logged, never swallowed.
        console.error('Consent after sign-up failed; the terms screen will ask again:', err);
      }
    } catch (err) {
      console.error('Sign-up code threw:', err);
      setErrorKey('signUp.errors.offline');
    } finally {
      setBusy(false);
      setAuthHold(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setErrorKey(null);
    setResent(false);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: draft.email.trim() });
      if (error) {
        console.error('Resend error:', error);
        setErrorKey(`signUp.errors.${authProblem(error, 'signUp')}`);
      } else {
        setResent(true);
      }
    } catch (err) {
      console.error('Resend threw:', err);
      setErrorKey('signUp.errors.offline');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            accessibilityRole="button"
            onPress={() => (step === 'code' ? (setStep('form'), setErrorKey(null)) : onBack())}
            style={styles.back}
            hitSlop={8}
            disabled={busy}
          >
            <Text style={styles.link}>‹ {t('signUp.back')}</Text>
          </Pressable>

          <Text style={styles.title}>{step === 'form' ? t('signUp.title') : t('signUp.codeTitle')}</Text>
          <Text style={styles.subtitle}>
            {step === 'form' ? t('signUp.subtitle') : t('signUp.codeSent', { email: draft.email.trim() })}
          </Text>

          {errorKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(errorKey)}</Text>
            </View>
          )}

          {step === 'form' ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>{t('signUp.name')}</Text>
                <TextInput
                  style={styles.input}
                  value={draft.fullName}
                  onChangeText={(fullName) => set({ fullName })}
                  autoComplete="name"
                  textContentType="name"
                  editable={!busy}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>{t('signIn.emailLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={draft.email}
                  onChangeText={(email) => set({ email })}
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
              <View style={styles.field}>
                <Text style={styles.label}>{t('signIn.passwordLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={draft.password}
                  onChangeText={(password) => set({ password })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  secureTextEntry
                  editable={!busy}
                />
                <Text style={styles.hint}>{t('signUp.passwordHint')}</Text>
              </View>

              {/* The box is its own button and the sentence its own text: a
                  Pressable around the whole row took every tap on Android, so
                  the two links ticked the box instead of opening. */}
              <View style={styles.consent}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: draft.consent }}
                  accessibilityLabel={`${t('signUp.consentStart')}${t('signUp.terms')}${t('signUp.consentMiddle')}${t('signUp.privacy')}`}
                  onPress={() => set({ consent: !draft.consent })}
                  hitSlop={10}
                  disabled={busy}
                >
                  <View style={[styles.box, draft.consent && styles.boxOn]}>
                    {draft.consent && <Text style={styles.tick}>✓</Text>}
                  </View>
                </Pressable>
                <Text style={styles.consentText} onPress={() => !busy && set({ consent: !draft.consent })}>
                  {t('signUp.consentStart')}
                  <Text style={styles.inlineLink} accessibilityRole="link" onPress={() => router.push('/terms')}>{t('signUp.terms')}</Text>
                  {t('signUp.consentMiddle')}
                  <Text style={styles.inlineLink} accessibilityRole="link" onPress={() => router.push('/privacy')}>{t('signUp.privacy')}</Text>
                  {t('signUp.consentEnd')}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={() => void submit()}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('signUp.submit')}</Text>}
              </Pressable>
            </>
          ) : (
            <>
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
              <Pressable
                accessibilityRole="button"
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={() => void confirm()}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('signUp.confirm')}</Text>}
              </Pressable>
              {resent && <Text style={styles.notice}>{t('signUp.resent')}</Text>}
              <Pressable accessibilityRole="button" onPress={() => void resend()} hitSlop={8} disabled={busy}>
                <Text style={styles.link}>{t('signUp.resend')}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
