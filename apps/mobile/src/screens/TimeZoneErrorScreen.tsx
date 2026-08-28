import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { translatorFor, detectLocale } from '../i18n';
import { theme } from '../theme';

/**
 * The blocking screen shown when assertTimeZoneSupport() fails.
 *
 * IT IS A DEAD END ON PURPOSE. There is no "continue anyway", no dismiss, and
 * no navigation off it. The failure means every date this runtime produces is
 * unreliable, and the specific consequence is that a transaction gets booked
 * into the wrong month with nothing on screen looking wrong. A way past this
 * screen would be a way to corrupt a household's ledger quietly, which is
 * strictly worse than an app that will not open.
 *
 * It renders WITHOUT the I18nProvider, because it mounts in place of the app
 * rather than inside it — hence translatorFor(detectLocale()) rather than the
 * hook.
 */
export default function TimeZoneErrorScreen({ message }: { message: string }) {
  const t = translatorFor(detectLocale());

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('timezone.title')}</Text>
        <Text style={styles.body}>{t('timezone.body')}</Text>
        <Text style={styles.body}>{t('timezone.consequence')}</Text>
        <Text style={styles.body}>{t('timezone.whatToDo')}</Text>

        <View style={styles.technical}>
          <Text style={styles.technicalLabel}>{t('timezone.technicalLabel')}</Text>
          {/* Verbatim, English, and selectable: this is the string that makes a
              device report actionable, and paraphrasing it would lose the two
              zone names and what they both formatted to. */}
          <Text selectable style={styles.technicalText}>
            {message}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.space.lg, gap: theme.space.md },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.color.heading,
    marginBottom: theme.space.xs,
  },
  body: { fontSize: 16, lineHeight: 24, color: theme.color.body },
  technical: {
    marginTop: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    gap: theme.space.sm,
  },
  technicalLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: theme.color.danger,
  },
  technicalText: { fontSize: 12, lineHeight: 18, color: theme.color.danger },
});
