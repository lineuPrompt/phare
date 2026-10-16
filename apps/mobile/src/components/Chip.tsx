import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

/** A pill choice — one of several, the selected one outlined. Shared by the entry and account forms. */
export default function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.color.surface,
  },
  chipSelected: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSurface },
  chipText: { fontSize: 14, color: theme.color.muted },
  chipTextSelected: { color: theme.color.heading, fontWeight: '600' },
});
