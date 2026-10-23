import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The More tab (Lineu, 2026-10-23): the web sidebar's secondary items, as a
 * short menu. Home, Timeline and Cards are the tabs; everything else opens
 * from here. Goals and Household get their rows when their screens exist —
 * no placeholders.
 */
export default function MoreScreen() {
  const { t } = useI18n();
  const router = useRouter();

  const rows: { label: string; href: Href }[] = [
    { label: t('tabs.review'), href: '/reviews' },
    { label: t('more.recurring'), href: '/recurring' },
    { label: t('tabs.account'), href: '/account' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('tabs.more')}</Text>
        <View style={styles.card}>
          {rows.map((row, i) => (
            <Pressable
              key={row.label}
              accessibilityRole="button"
              onPress={() => router.push(row.href)}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && styles.pressed]}
            >
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.space.md, gap: theme.space.md },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading, paddingHorizontal: theme.space.xs },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.space.md,
    paddingVertical: 16,
  },
  divider: { borderTopWidth: 1, borderTopColor: theme.color.border },
  pressed: { opacity: 0.6 },
  label: { fontSize: 16, color: theme.color.body },
  chevron: { fontSize: 20, color: theme.color.muted },
});
