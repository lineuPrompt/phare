import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/** The "+" in the Timeline and Cards headers: opens quick entry as a modal. */
export default function AddEntryButton() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('entry.open')}
      onPress={() => router.push('/add')}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.plus}>+</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.heading,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  plus: { fontSize: 24, lineHeight: 26, fontWeight: '600', color: theme.color.surface },
});
