import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/** "‹ More" — the way back from a screen opened from the More tab. */
export default function BackToMore() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={styles.row}>
      <Text style={styles.text}>‹ {t('tabs.more')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'flex-start', paddingHorizontal: theme.space.xs, paddingVertical: theme.space.xs },
  text: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
});
