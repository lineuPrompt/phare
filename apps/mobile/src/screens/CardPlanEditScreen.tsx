import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiGet, apiPost, messageKeyFor } from '../lib/api';
import {
  buildPlanBody,
  canEditPlan,
  draftFrom,
  loadCardDetail,
  overGoal,
  savePlan,
  type CardDetail,
  type PlanDraft,
} from '../lib/cardPlan';
import { emitEntrySaved } from '../lib/entryEvents';
import { formatMonthLong } from '../lib/timelineView';
import Chip from '../components/Chip';
import { formStyles as styles } from '../components/formStyles';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Edit one card's plan for one month (standalone S5): the monthly goal, the
 * category budgets, and the card's statement and payment days — what the web
 * card editor sets, through the same POST /api/card-envelope.
 *
 * The server keeps the rules: a closed statement is refused (409), and when
 * later months hold plans of their own the household must say, for exactly
 * those months, whether this plan replaces them. Save stays unavailable until
 * that choice is made; nothing is pre-selected.
 */
export default function CardPlanEditScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ cardId?: string; month?: string }>();
  const cardId = typeof params.cardId === 'string' ? params.cardId : null;
  const month = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;

  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [laterMonths, setLaterMonths] = useState<string[]>([]);
  const [laterChoice, setLaterChoice] = useState<'apply' | 'keep' | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!cardId || !month) {
      setMessageKey('cardPlan.errors.notFound');
      return null;
    }
    try {
      return await loadCardDetail(apiGet, cardId, month, locale);
    } catch (err) {
      console.error('Card plan editor load error:', err);
      setMessageKey(messageKeyFor(err));
      return null;
    }
  }, [cardId, month, locale]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await load();
      if (cancelled || !loaded) return;
      setDetail(loaded);
      setDraft(draftFrom(loaded));
      setLaterMonths(loaded.laterPlanMonths);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const close = () => router.back();
  const update = (patch: Partial<PlanDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setAmount = (categoryId: string, amount: string) =>
    setDraft((d) => d && { ...d, items: d.items.map((i) => (i.categoryId === categoryId ? { ...i, amount } : i)) });
  const removeItem = (categoryId: string) =>
    setDraft((d) => d && { ...d, items: d.items.filter((i) => i.categoryId !== categoryId) });
  const addItem = (category: { id: string; name: string }) =>
    setDraft((d) => d && { ...d, items: [...d.items, { categoryId: category.id, categoryName: category.name, amount: '' }] });

  const needsLaterChoice = laterMonths.length > 0 && laterChoice === null;

  const save = async () => {
    if (!cardId || !month || !draft) return;
    if (needsLaterChoice) {
      setMessageKey('cardPlan.editor.laterChooseFirst');
      return;
    }
    const built = buildPlanBody(cardId, month, draft, laterChoice ? { choice: laterChoice, months: laterMonths } : null);
    if (!built.ok) {
      setMessageKey(`cardPlan.problems.${built.problem}`);
      return;
    }
    setSaving(true);
    setMessageKey(null);
    const outcome = await savePlan(apiPost, built.body);
    setSaving(false);
    if (outcome.kind === 'saved') {
      emitEntrySaved();
      close();
    } else if (outcome.kind === 'savedDaysFailed') {
      emitEntrySaved();
      setMessageKey('cardPlan.errors.daysFailed');
    } else if (outcome.kind === 'laterPlansRequired') {
      // The later months changed since this opened: show the current list and ask again.
      const fresh = await load();
      if (fresh) setLaterMonths(fresh.laterPlanMonths);
      setLaterChoice(null);
      setMessageKey('cardPlan.editor.laterChanged');
    } else {
      setMessageKey(outcome.messageKey);
    }
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>
        {month ? t('cardPlan.editor.title', { month: formatMonthLong(month, locale) }) : t('cardPlan.edit')}
      </Text>
      <Pressable accessibilityRole="button" onPress={close} hitSlop={8}>
        <Text style={styles.close}>{t('common.dismiss')}</Text>
      </Pressable>
    </View>
  );

  if (!detail || !draft) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          {messageKey ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey)}</Text>
            </View>
          ) : (
            <ActivityIndicator color={theme.color.heading} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (!canEditPlan(detail)) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          {header}
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('cardPlan.errors.cycleClosed')}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const used = new Set(draft.items.map((i) => i.categoryId));
  const available = detail.categories.filter((c) => !used.has(c.id));

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {header}
          <Text style={styles.intro}>{detail.card.name}</Text>

          <Text style={styles.label}>{t('cardPlan.editor.goal')}</Text>
          <TextInput
            style={styles.input}
            value={draft.goal}
            onChangeText={(goal) => update({ goal })}
            keyboardType="decimal-pad"
            accessibilityLabel={t('cardPlan.editor.goal')}
          />

          <Text style={styles.label}>{t('cardPlan.editor.budgets')}</Text>
          {draft.items.map((item) => (
            <View key={item.categoryId} style={{ gap: theme.space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: theme.space.xs }}>
                <Text style={{ fontSize: 15, color: theme.color.body, flex: 1 }} numberOfLines={1}>{item.categoryName}</Text>
                <Pressable accessibilityRole="button" onPress={() => removeItem(item.categoryId)} hitSlop={8}>
                  <Text style={styles.close}>{t('cardPlan.editor.remove')}</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.input}
                value={item.amount}
                onChangeText={(amount) => setAmount(item.categoryId, amount)}
                keyboardType="decimal-pad"
                accessibilityLabel={item.categoryName}
              />
            </View>
          ))}
          {available.length > 0 && (
            <>
              <Text style={styles.hint}>{t('cardPlan.editor.addCategory')}</Text>
              <View style={styles.chips}>
                {available.map((c) => (
                  <Chip key={c.id} label={c.name} selected={false} onPress={() => addItem(c)} />
                ))}
              </View>
            </>
          )}
          {overGoal(draft) && <Text style={[styles.hint, { color: theme.color.warning }]}>{t('cardPlan.editor.overGoal')}</Text>}

          <Text style={styles.label}>{t('cardPlan.editor.closeDay')}</Text>
          <TextInput
            style={styles.input}
            value={draft.closeDay}
            onChangeText={(closeDay) => update({ closeDay })}
            keyboardType="number-pad"
            accessibilityLabel={t('cardPlan.editor.closeDay')}
          />
          <Text style={styles.label}>{t('cardPlan.editor.payDay')}</Text>
          <TextInput
            style={styles.input}
            value={draft.payDay}
            onChangeText={(payDay) => update({ payDay })}
            keyboardType="number-pad"
            accessibilityLabel={t('cardPlan.editor.payDay')}
          />
          <Text style={styles.hint}>{t('cardPlan.editor.daysHint')}</Text>

          {laterMonths.length > 0 && (
            <>
              <Text style={styles.label}>
                {t('cardPlan.editor.later', { months: laterMonths.map((m) => formatMonthLong(m, locale)).join(', ') })}
              </Text>
              <View style={styles.chips}>
                <Chip label={t('cardPlan.editor.laterApply')} selected={laterChoice === 'apply'} onPress={() => setLaterChoice('apply')} />
                <Chip label={t('cardPlan.editor.laterKeep')} selected={laterChoice === 'keep'} onPress={() => setLaterChoice('keep')} />
              </View>
            </>
          )}

          {messageKey && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t(messageKey)}</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={() => void save()}
            disabled={saving || needsLaterChoice}
            style={({ pressed }) => [styles.button, (pressed || saving || needsLaterChoice) && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>{saving ? t('cardPlan.editor.saving') : t('cardPlan.editor.save')}</Text>
          </Pressable>
          {needsLaterChoice && <Text style={styles.hint}>{t('cardPlan.editor.laterChooseFirst')}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
