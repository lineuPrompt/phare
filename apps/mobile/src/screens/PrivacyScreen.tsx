import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { PRIVACY_POLICY } from '@phare/core';
import { useI18n } from '../i18n';
import { theme } from '../theme';
import { boldRuns, legalBlocks } from '../lib/legalDocument';

/**
 * The Privacy Policy, inside the app (App Store 5.1.1(i)): the same text the
 * web /privacy page shows, from @phare/core, in the app's language. No web
 * view and no link out — the web pages carry pricing, which this app must not
 * lead to (3.1.1).
 */
export default function PrivacyScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const blocks = legalBlocks(PRIVACY_POLICY[locale]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>{t('privacy.back')}</Text>
        </Pressable>
        {blocks.map((block, i) => {
          switch (block.kind) {
            case 'title':
              return <Text key={i} style={styles.title} accessibilityRole="header">{block.text}</Text>;
            case 'updated':
              return <Text key={i} style={styles.updated}>{t('privacy.lastUpdated', { date: block.date })}</Text>;
            case 'heading':
              return <Text key={i} style={styles.heading} accessibilityRole="header">{block.text}</Text>;
            case 'paragraph':
              return (
                <Text key={i} style={styles.paragraph}>
                  {boldRuns(block.text).map((run, j) => (
                    <Text key={j} style={run.bold ? styles.bold : undefined}>{run.text}</Text>
                  ))}
                </Text>
              );
          }
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.space.md, gap: theme.space.sm, paddingBottom: theme.space.xl },
  back: { alignSelf: 'flex-start', paddingVertical: theme.space.xs },
  backText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading },
  updated: { fontSize: 13, color: theme.color.muted, marginBottom: theme.space.sm },
  heading: { fontSize: 18, fontWeight: '700', color: theme.color.heading, marginTop: theme.space.md },
  paragraph: { fontSize: 15, lineHeight: 22, color: theme.color.body },
  bold: { fontWeight: '700' },
});
