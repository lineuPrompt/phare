import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import ActionButton from './ActionButton';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * What a household without Pro sees where the rest of a letter would be.
 *
 * SINCE IN-APP PURCHASE (2026-10-17) it may offer Phare Pro: "See Phare Pro"
 * opens the app's own purchase screen, which sells through Apple (Guideline
 * 3.1.1 permits exactly that). What it still must never do: show a typed
 * price, name Stripe, or point to buying on the website. The compliance scans
 * enforce all three over source and bundle.
 *
 * The gating itself is NOT done here and must not be. The server truncates the
 * text before it is sent (src/app/api/reviews/route.ts -> reviewForEntitlement),
 * so the withheld part is absent from the payload rather than hidden in the
 * client. This component only renders the fact that truncation happened.
 */
export default function LockedNotice() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{t('review.locked')}</Text>
      <ActionButton label={t('pro.see')} onPress={() => router.push('/pro')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.background,
  },
  text: { fontSize: 14, lineHeight: 20, color: theme.color.muted },
});
