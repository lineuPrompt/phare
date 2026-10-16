import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

/**
 * The button under an empty state: "Set your balance", "Add a card". Before
 * standalone S3 these states sent people to phare.money; now they open the
 * screen that fixes them. `onDark` for the navy Plan card.
 */
export default function ActionButton({ label, onPress, onDark = false }: { label: string; onPress: () => void; onDark?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, onDark && styles.buttonOnDark, pressed && styles.pressed]}
    >
      <Text style={[styles.text, onDark && styles.textOnDark]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.heading,
    borderRadius: 999,
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    marginTop: theme.space.sm,
  },
  buttonOnDark: { backgroundColor: theme.color.accent },
  pressed: { opacity: 0.6 },
  text: { fontSize: 15, fontWeight: '700', color: theme.color.surface },
  textOnDark: { color: theme.color.heading },
});
