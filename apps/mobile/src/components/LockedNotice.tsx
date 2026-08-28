import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * What a free household sees where the rest of a letter would be.
 *
 * READ THIS BEFORE CHANGING IT.
 *
 * This component must contain no price, no plan name, no upgrade button, no
 * link to pricing, and no copy that steers toward paying. Not because the copy
 * is unfinished — because App Store Review Guideline 3.1.1 forbids an iOS app
 * from directing users to a purchase mechanism outside Apple's in-app
 * purchase, and Phare's subscription is sold through Stripe on the web. An
 * "Upgrade" button here is the kind of thing that gets a build rejected and,
 * once shipped, is a compliance problem rather than a copy tweak.
 *
 * So this states a fact and stops: part of the letter is not included. It does
 * not say what would include it, what it costs, or where to get it. A user who
 * wants more finds it on the website, which is allowed to sell.
 *
 * The gating itself is NOT done here and must not be. The server truncates the
 * text before it is sent (src/app/api/reviews/route.ts → reviewForEntitlement),
 * so the withheld part is absent from the payload rather than hidden in the
 * client. This component only renders the fact that truncation happened.
 */
export default function LockedNotice() {
  const { t } = useI18n();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{t('review.locked')}</Text>
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
