import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiGet } from '../lib/api';
import { proOffer, type Me } from '../lib/subscription';
import { onEntrySaved } from '../lib/entryEvents';
import ActionButton from './ActionButton';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/** The Account tab's Phare Pro line: where the household stands, and the way in. */
export default function ProSection() {
  const { t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const loaded = await apiGet<Me>('/api/me');
        if (!cancelled) setMe(loaded);
      } catch (err) {
        // Informational only; the Phare Pro screen reports its own errors.
        console.error('Phare Pro status load error:', err);
      }
    };
    void load();
    // A verified purchase emits entrySaved (IapListener): refresh the status.
    const unsubscribe = onEntrySaved(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const offer = me ? proOffer(me) : null;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('pro.section')}</Text>
      {offer && (
        <Text style={styles.body}>{offer.kind === 'alreadyPro' ? t('pro.alreadyPro') : t('pro.statusFree')}</Text>
      )}
      <ActionButton label={t('pro.see')} onPress={() => router.push('/pro')} />
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
    gap: theme.space.xs,
  },
  heading: { fontSize: 17, fontWeight: '700', color: theme.color.heading },
  body: { fontSize: 15, color: theme.color.body },
});
