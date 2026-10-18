import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { HORIZON_MONTHS_FREE, HORIZON_MONTHS_PRO, REGENERATIONS_PER_MONTH } from '@phare/core';
import { apiGet, apiPost, messageKeyFor } from '../lib/api';
import { appStore, openManageSubscriptions } from '../lib/iap';
import { loadProducts, proOffer, restore, subscribe, verifyErrorKey, type Me, type ProOffer, type ProProduct } from '../lib/subscription';
import { onSubscriptionEvent } from '../lib/subscriptionEvents';
import { formStyles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Phare Pro, sold through Apple (piece 3; docs/iap-design.md).
 *
 * WHAT GUIDELINE 3.1.2(c) ASKS, AND WHERE IT IS: what Pro gives (the feature
 * list, its numbers from @phare/core, the same the server enforces), each
 * plan's price and period (StoreKit's own displayPrice, never typed here), the
 * auto-renewal terms, and working links to the Terms of Use and the Privacy
 * Policy.
 *
 * TERMS OF USE: Apple's standard licence agreement for now. Phare's own terms
 * for the app are with counsel (decision 4); swap the link when they land.
 *
 * The purchase result arrives through IapListener (the one StoreKit listener)
 * and reaches this screen as a subscription event. Pro is shown from the
 * server's answer only.
 */

const APPLE_STANDARD_EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

type Loaded = { offer: ProOffer; products: ProProduct[] | null };

/** Fetch everything the screen shows. No state is touched here: see apply. */
async function fetchLoaded(): Promise<{ loaded: Loaded | null; errorKey: string | null }> {
  try {
    const offer = proOffer(await apiGet<Me>('/api/me'));
    // Prices only when a purchase is on offer: the owner of a household
    // without Pro. Anyone else is told where they stand, not shown a price.
    if (offer.kind !== 'canSubscribe') return { loaded: { offer, products: null }, errorKey: null };
    try {
      return { loaded: { offer, products: await loadProducts(appStore) }, errorKey: null };
    } catch (err) {
      console.error('StoreKit products error:', err);
      return { loaded: { offer, products: null }, errorKey: 'pro.errors.products' };
    }
  } catch (err) {
    console.error('Phare Pro load error:', err);
    return { loaded: null, errorKey: messageKeyFor(err) };
  }
}

export default function ProScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((result: { loaded: Loaded | null; errorKey: string | null }) => {
    if (result.loaded) setLoaded(result.loaded);
    setErrorKey(result.errorKey);
  }, []);

  /** Re-read after a purchase, a restore, or a retry. */
  const load = useCallback(async () => apply(await fetchLoaded()), [apply]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchLoaded();
      if (!cancelled) apply(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // The outcome of a purchase made here, or delivered by StoreKit while open.
  useEffect(
    () =>
      onSubscriptionEvent((event) => {
        setBusy(false);
        if (event.kind === 'verified') {
          setNotice(t('pro.welcome'));
          void load();
        } else if (event.kind === 'failed') {
          setErrorKey(verifyErrorKey(event.error));
        } else if (event.kind === 'storeError') {
          setErrorKey('pro.errors.store');
        }
      }),
    [load, t]
  );

  const buy = async (product: ProProduct) => {
    if (!loaded) return;
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      await subscribe(appStore, loaded.offer, product.id);
      // Busy until the listener reports: Apple's sheet is on screen.
    } catch (err) {
      console.error('StoreKit request error:', err);
      setBusy(false);
      setErrorKey('pro.errors.store');
    }
  };

  const restorePurchases = async () => {
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    const outcome = await restore(appStore, apiPost);
    setBusy(false);
    if (outcome.kind === 'restored') {
      setNotice(t('pro.restored'));
      void load();
    } else if (outcome.kind === 'nothingToRestore') {
      setNotice(t('pro.nothingToRestore'));
    } else {
      console.error('Restore failed:', outcome.error);
      setErrorKey(verifyErrorKey(outcome.error));
    }
  };

  const offer = loaded?.offer ?? null;

  return (
    <SafeAreaView style={formStyles.safe}>
      <ScrollView contentContainerStyle={formStyles.content}>
        <View style={formStyles.header}>
          <Text style={formStyles.title}>{t('pro.title')}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
            <Text style={formStyles.close}>{t('common.dismiss')}</Text>
          </Pressable>
        </View>

        <Text style={formStyles.intro}>{t('pro.intro')}</Text>
        <View style={styles.features}>
          {[
            t('pro.features.horizon', { months: HORIZON_MONTHS_PRO, free: HORIZON_MONTHS_FREE }),
            t('pro.features.review'),
            t('pro.features.regenerate', { count: REGENERATIONS_PER_MONTH }),
            t('pro.features.categories'),
          ].map((line) => (
            <Text key={line} style={styles.feature}>
              • {line}
            </Text>
          ))}
        </View>

        {!loaded && !errorKey && <ActivityIndicator color={theme.color.heading} />}

        {offer?.kind === 'alreadyPro' && (
          <View style={styles.status}>
            <Text style={styles.statusText}>{t('pro.alreadyPro')}</Text>
            {offer.throughApple && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void openManageSubscriptions().catch((err: unknown) => console.error(err))}
                style={({ pressed }) => [formStyles.secondaryButton, pressed && formStyles.buttonPressed]}
              >
                <Text style={formStyles.secondaryButtonText}>{t('pro.manage')}</Text>
              </Pressable>
            )}
          </View>
        )}

        {offer?.kind === 'ownerOnly' && <Text style={formStyles.intro}>{t('pro.ownerOnly')}</Text>}

        {offer?.kind === 'canSubscribe' &&
          loaded?.products?.map((product) => (
            <View key={product.id} style={styles.plan}>
              <Text style={styles.planName}>{product.period === 'year' ? t('pro.yearly') : t('pro.monthly')}</Text>
              <Text style={styles.planPrice}>
                {product.period === 'year'
                  ? t('pro.perYear', { price: product.displayPrice })
                  : t('pro.perMonth', { price: product.displayPrice })}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void buy(product)}
                disabled={busy}
                style={({ pressed }) => [formStyles.button, (pressed || busy) && formStyles.buttonPressed]}
              >
                <Text style={formStyles.buttonText}>{busy ? t('pro.working') : t('pro.subscribe')}</Text>
              </Pressable>
            </View>
          ))}

        {notice && <Text style={formStyles.saved}>{notice}</Text>}
        {errorKey && (
          <View style={formStyles.errorBox}>
            <Text style={formStyles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} hitSlop={8}>
              <Text style={formStyles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {/* Restore is offered to everyone: a new phone, or a reinstall. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => void restorePurchases()}
          disabled={busy}
          style={({ pressed }) => [formStyles.secondaryButton, (pressed || busy) && formStyles.buttonPressed]}
        >
          <Text style={formStyles.secondaryButtonText}>{t('pro.restore')}</Text>
        </Pressable>

        <Text style={styles.small}>{t('pro.renewal')}</Text>
        <View style={styles.links}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(APPLE_STANDARD_EULA)} hitSlop={8}>
            <Text style={styles.link}>{t('pro.termsOfUse')}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')} hitSlop={8}>
            <Text style={styles.link}>{t('pro.privacy')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  features: { gap: theme.space.xs, paddingHorizontal: theme.space.xs, marginVertical: theme.space.sm },
  feature: { fontSize: 15, lineHeight: 22, color: theme.color.body },
  status: {
    backgroundColor: theme.color.accentSurface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  statusText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
  plan: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  planName: { fontSize: 17, fontWeight: '700', color: theme.color.heading },
  planPrice: { fontSize: 15, color: theme.color.body },
  small: { fontSize: 12, lineHeight: 18, color: theme.color.muted, paddingHorizontal: theme.space.xs, marginTop: theme.space.sm },
  links: { flexDirection: 'row', gap: theme.space.lg, paddingHorizontal: theme.space.xs },
  link: { fontSize: 13, fontWeight: '600', color: theme.color.accent, textDecorationLine: 'underline' },
});
