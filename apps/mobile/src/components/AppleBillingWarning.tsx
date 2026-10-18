import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiGet } from '../lib/api';
import { openManageSubscriptions } from '../lib/iap';
import { needsCancelWarning, type Me } from '../lib/subscription';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Above "Delete my account": an App Store subscription that is still renewing
 * keeps billing after the account is gone, and only the person can cancel it,
 * in Apple's settings. Says so and opens those settings. Deletion stays
 * possible (Lineu, 2026-10-17; Guideline 5.1.1(v)).
 */
export default function AppleBillingWarning() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<Me>('/api/me')
      .then((loaded) => {
        if (!cancelled) setMe(loaded);
      })
      .catch((err: unknown) => console.error('Billing warning load error:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me || !needsCancelWarning(me)) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.text}>{t('deletion.appleSubscription')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void openManageSubscriptions().catch((err: unknown) => console.error(err))}
        hitSlop={8}
      >
        <Text style={styles.link}>{t('deletion.manageSubscription')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.color.warningSurface,
    borderWidth: 1,
    borderColor: theme.color.warning,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  text: { fontSize: 14, lineHeight: 20, color: theme.color.warning },
  link: { fontSize: 14, fontWeight: '700', color: theme.color.warning },
});
