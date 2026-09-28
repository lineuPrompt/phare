import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCADLocale, formatResetDate, monthlyEquivalent, parseAmountInput, type IncomeFrequency } from '@phare/core';
import { apiGet, apiPatch, apiPost } from '../lib/api';
import {
  buildForm,
  CARD_COUNTS,
  createOnboardingRunner,
  emptyLine,
  formProblemKey,
  FREQUENCIES,
  normaliseOpeningBalance,
  onboardingErrorKey,
  resolveCardNames,
  type BuiltForm,
  type DraftLine,
  type FormProblem,
  type PayDateInput,
  type PayDateItem,
  type Plan,
} from '../lib/onboardingFlow';
import { ApiError } from '../lib/apiErrors';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Manual onboarding: the web upload page's manual lane, on a phone.
 *
 * Steps: form → (plausibility) → accounts → working → (payDates) → done.
 * Every server call and every rule lives in onboardingFlow.ts; this file only
 * holds state and draws it. What it will not do — confirm a replace, loop on
 * /api/plan, anchor before a save — is enforced there, not here.
 */

type Step =
  | { name: 'form' }
  | { name: 'plausibility'; built: BuiltForm }
  | { name: 'accounts'; built: BuiltForm }
  | { name: 'working'; phase: 'plan' | 'review' | 'save' }
  | { name: 'planError'; messageKey: string; resetsOn: string | null; built: BuiltForm }
  | { name: 'saveError'; plan: Plan; reviewText: string; reviewInfo: ReviewInfo; cardNames: string[]; openingValue: string }
  | { name: 'needsConfirmation' }
  | { name: 'payDates'; items: PayDateItem[]; after: DoneInfo }
  | { name: 'done'; info: DoneInfo };

type ReviewInfo = { text: string | null; noteKey: string | null; resetsOn: string | null };

type DoneInfo = {
  reviewText: string | null;
  reviewNoteKey: string | null;
  reviewResetsOn: string | null;
  anchor: 'skipped' | 'anchored' | 'failed';
};

export default function OnboardingScreen({ onFinished }: { onFinished: () => void }) {
  const { t, locale } = useI18n();
  const runner = useMemo(
    () => createOnboardingRunner({ get: apiGet, post: apiPost, patch: apiPatch, locale }),
    [locale]
  );

  const [step, setStep] = useState<Step>({ name: 'form' });
  const [income, setIncome] = useState<DraftLine[]>([emptyLine()]);
  const [expenses, setExpenses] = useState<DraftLine[]>([emptyLine()]);
  const [stated, setStated] = useState('');
  const [formProblem, setFormProblem] = useState<FormProblem | null>(null);

  const [cardCount, setCardCount] = useState(1);
  const [cardNames, setCardNames] = useState<string[]>(['', '', '']);
  const [opening, setOpening] = useState('');
  const [openingInvalid, setOpeningInvalid] = useState(false);

  // ── Form ──────────────────────────────────────────────────────────────────
  const submitForm = () => {
    const result = buildForm(income, expenses, stated);
    if (!result.ok) {
      setFormProblem(result.problem);
      return;
    }
    setFormProblem(null);
    setStep(result.value.guard.ok ? { name: 'accounts', built: result.value } : { name: 'plausibility', built: result.value });
  };

  // ── The run: plan → review → save → anchor ────────────────────────────────
  const finishAfterSave = async (
    outcome: Awaited<ReturnType<typeof runner.save>>,
    review: ReviewInfo,
    openingValue: string
  ) => {
    // The runner decides: no anchor on needsConfirmation (nothing was
    // written; replacing data stays on the web in V1), otherwise anchor now.
    const next = await runner.afterSave(outcome, openingValue);
    if (next.kind === 'needsConfirmation') {
      setStep({ name: 'needsConfirmation' });
      return;
    }
    const info: DoneInfo = {
      reviewText: review.text,
      reviewNoteKey: review.noteKey,
      reviewResetsOn: review.resetsOn,
      anchor: next.anchor,
    };
    setStep(next.kind === 'payDates' ? { name: 'payDates', items: next.items, after: info } : { name: 'done', info });
  };

  const run = async (built: BuiltForm) => {
    const balance = normaliseOpeningBalance(opening);
    if (!balance.ok) {
      setOpeningInvalid(true);
      return;
    }
    setOpeningInvalid(false);
    const names = resolveCardNames(cardCount, cardNames, (n) => t('onboarding.accounts.defaultCardName', { n }));

    setStep({ name: 'working', phase: 'plan' });
    let plan: Plan;
    try {
      plan = await runner.buildPlan(built.calculated);
    } catch (err) {
      console.error('Onboarding plan error:', err);
      setStep({
        name: 'planError',
        messageKey: onboardingErrorKey(err),
        resetsOn: err instanceof ApiError ? err.resetsOn : null,
        built,
      });
      return;
    }

    setStep({ name: 'working', phase: 'review' });
    const review = await runner.review(plan);
    const reviewText = review.ok ? review.text : t('onboarding.plan.reviewUnavailableForSave');
    const reviewInfo: ReviewInfo = review.ok
      ? { text: review.text, noteKey: null, resetsOn: null }
      : { text: null, noteKey: review.messageKey, resetsOn: review.resetsOn };

    await save(plan, reviewText, reviewInfo, names, balance.value);
  };

  const save = async (
    plan: Plan,
    reviewText: string,
    reviewInfo: ReviewInfo,
    names: string[],
    openingValue: string
  ) => {
    setStep({ name: 'working', phase: 'save' });
    try {
      const outcome = await runner.save(plan, reviewText, names);
      await finishAfterSave(outcome, reviewInfo, openingValue);
    } catch (err) {
      console.error('Onboarding save error:', err);
      setStep({ name: 'saveError', plan, reviewText, reviewInfo, cardNames: names, openingValue });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  let body: React.ReactNode;

  if (step.name === 'form') {
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.form.title')}</Text>
        <Text style={styles.hint}>{t('onboarding.form.subtitle')}</Text>

        <Section title={t('onboarding.form.income')} hint={t('onboarding.form.incomeHint')}>
          <Lines
            lines={income}
            setLines={setIncome}
            labelPlaceholder={t('onboarding.form.sourcePlaceholder')}
            amountPlaceholder={t('onboarding.form.amountPerPay')}
            problemIndex={formProblem && 'section' in formProblem && formProblem.section === 'income' ? formProblem.index : null}
          />
        </Section>

        <Section title={t('onboarding.form.expenses')} hint={t('onboarding.form.expenseHint')}>
          <Lines
            lines={expenses}
            setLines={setExpenses}
            labelPlaceholder={t('onboarding.form.expensePlaceholder')}
            amountPlaceholder={t('onboarding.form.expenseAmountPlaceholder')}
            problemIndex={formProblem && 'section' in formProblem && formProblem.section === 'expenses' ? formProblem.index : null}
          />
        </Section>

        <Text style={styles.label}>{t('onboarding.form.combinedIncome')}</Text>
        <TextInput
          style={styles.input}
          value={stated}
          onChangeText={setStated}
          keyboardType="decimal-pad"
          placeholder={t('onboarding.form.combinedIncomePlaceholder')}
          accessibilityLabel={t('onboarding.form.combinedIncome')}
        />
        <Text style={styles.small}>{t('onboarding.form.combinedIncomeHint')}</Text>

        {formProblem && <ErrorBox text={t(formProblemKey(formProblem))} />}
        <PrimaryButton label={t('onboarding.form.submit')} onPress={submitForm} />
      </>
    );
  } else if (step.name === 'plausibility') {
    const issues = step.built.guard.ok ? [] : step.built.guard.issues;
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.plausibility.title')}</Text>
        {issues.map((issue, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.cardText}>
              {issue.prong === 'income_vs_stated'
                ? t('onboarding.plausibility.incomeVsStated', {
                    stated: formatCADLocale(issue.statedAnnual, locale),
                    computed: formatCADLocale(issue.computedAnnual, locale),
                  })
                : t('onboarding.plausibility.deficitNotFinanced', {
                    deficit: formatCADLocale(issue.monthlyDeficit, locale),
                  })}
            </Text>
          </View>
        ))}
        <PrimaryButton label={t('onboarding.plausibility.correct')} onPress={() => setStep({ name: 'form' })} />
        <SecondaryButton
          label={t('onboarding.plausibility.confirm')}
          onPress={() => setStep({ name: 'accounts', built: step.built })}
        />
      </>
    );
  } else if (step.name === 'accounts' || step.name === 'planError') {
    const built = step.built;
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.accounts.title')}</Text>
        <Text style={styles.hint}>{t('onboarding.accounts.subtitle')}</Text>

        <Text style={styles.label}>{t('onboarding.accounts.howMany')}</Text>
        <View style={styles.chips}>
          {CARD_COUNTS.map((n) => (
            <Chip key={n} label={String(n)} selected={cardCount === n} onPress={() => setCardCount(n)} />
          ))}
        </View>

        {cardCount > 0 && <Text style={styles.label}>{t('onboarding.accounts.nameThem')}</Text>}
        {Array.from({ length: cardCount }, (_, i) => (
          <TextInput
            key={i}
            style={styles.input}
            value={cardNames[i]}
            onChangeText={(v) => setCardNames((names) => names.map((x, j) => (j === i ? v : x)))}
            placeholder={t('onboarding.accounts.defaultCardName', { n: i + 1 })}
            accessibilityLabel={t('onboarding.accounts.nameThem')}
          />
        ))}

        <Text style={styles.label}>{t('onboarding.accounts.openingBalance')}</Text>
        <TextInput
          style={styles.input}
          value={opening}
          onChangeText={(v) => {
            setOpening(v);
            setOpeningInvalid(false);
          }}
          keyboardType="decimal-pad"
          placeholder={t('onboarding.accounts.openingBalancePlaceholder')}
          accessibilityLabel={t('onboarding.accounts.openingBalance')}
        />
        <Text style={styles.small}>{t('onboarding.accounts.openingBalanceHint')}</Text>
        {openingInvalid && <ErrorBox text={t('onboarding.accounts.openingBalanceInvalid')} />}

        {step.name === 'planError' && (
          <ErrorBox
            text={t(step.messageKey, { date: formatResetDate(step.resetsOn ?? undefined, locale) })}
          />
        )}

        {/* A retry is this button, pressed by a person. Each press spends one
            of the household's monthly plan generations; nothing presses it
            again on their behalf. */}
        <PrimaryButton label={t('onboarding.accounts.continue')} onPress={() => void run(built)} />
      </>
    );
  } else if (step.name === 'working') {
    body = (
      <View style={styles.centred}>
        <ActivityIndicator color={theme.color.heading} />
        <Text style={styles.hint}>
          {step.phase === 'plan'
            ? t('onboarding.working.plan')
            : step.phase === 'review'
              ? t('onboarding.working.review')
              : t('onboarding.working.save')}
        </Text>
      </View>
    );
  } else if (step.name === 'saveError') {
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.plan.saveErrorTitle')}</Text>
        <ErrorBox text={t('onboarding.plan.saveError')} />
        {/* Retrying the SAVE only. The plan is already generated and held here. */}
        <PrimaryButton
          label={t('common.retry')}
          onPress={() => void save(step.plan, step.reviewText, step.reviewInfo, step.cardNames, step.openingValue)}
        />
      </>
    );
  } else if (step.name === 'needsConfirmation') {
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.needsConfirmation.title')}</Text>
        <Text style={styles.body}>{t('onboarding.needsConfirmation.body')}</Text>
        <PrimaryButton label={t('onboarding.needsConfirmation.checkAgain')} onPress={onFinished} />
      </>
    );
  } else if (step.name === 'payDates') {
    body = <PayDates items={step.items} runner={runner} onDone={() => setStep({ name: 'done', info: step.after })} />;
  } else {
    const info = step.info;
    body = (
      <>
        <Text style={styles.title}>{t('onboarding.done.title')}</Text>
        {info.anchor === 'failed' && <ErrorBox text={t('onboarding.done.anchorFailed')} />}
        {info.reviewText ? (
          <View style={styles.card}>
            <Text style={styles.letter}>{info.reviewText}</Text>
          </View>
        ) : (
          info.reviewNoteKey && (
            <Text style={styles.body}>
              {t(info.reviewNoteKey, { date: formatResetDate(info.reviewResetsOn ?? undefined, locale) })}
            </Text>
          )
        )}
        <PrimaryButton label={t('onboarding.done.continue')} onPress={onFinished} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Lines({
  lines,
  setLines,
  labelPlaceholder,
  amountPlaceholder,
  problemIndex,
}: {
  lines: DraftLine[];
  setLines: (next: DraftLine[]) => void;
  labelPlaceholder: string;
  amountPlaceholder: string;
  problemIndex: number | null;
}) {
  const { t, locale } = useI18n();
  const set = (i: number, patch: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <View style={styles.lines}>
      {lines.map((line, i) => {
        const amount = parseAmountInput(line.amount);
        // A preview of core's monthly figure, shown only for an amount that
        // reads exactly. The server recomputes from the per-payment amount.
        const monthly = amount !== null && amount > 0 ? monthlyEquivalent(amount, line.frequency) : null;
        return (
          <View key={i} style={[styles.line, problemIndex === i && styles.lineProblem]}>
            <TextInput
              style={styles.input}
              value={line.label}
              onChangeText={(label) => set(i, { label })}
              placeholder={labelPlaceholder}
              accessibilityLabel={labelPlaceholder}
            />
            <TextInput
              style={styles.input}
              value={line.amount}
              onChangeText={(v) => set(i, { amount: v })}
              keyboardType="decimal-pad"
              placeholder={amountPlaceholder}
              accessibilityLabel={amountPlaceholder}
            />
            <View style={styles.chips}>
              {FREQUENCIES.map((f) => (
                <Chip key={f} label={frequencyLabel(t, f)} selected={line.frequency === f} onPress={() => set(i, { frequency: f })} />
              ))}
            </View>
            {monthly !== null && (
              <Text style={styles.monthly}>{t('onboarding.form.perMonthEquals', { amount: formatCADLocale(monthly, locale) })}</Text>
            )}
          </View>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => setLines([...lines, emptyLine()])} hitSlop={8}>
        <Text style={styles.link}>{t('onboarding.form.addLine')}</Text>
      </Pressable>
    </View>
  );
}

/** Literal keys, one per frequency, so the parity test sees each. */
function frequencyLabel(t: (k: string) => string, f: IncomeFrequency): string {
  switch (f) {
    case 'weekly': return t('onboarding.form.freq.weekly');
    case 'biweekly': return t('onboarding.form.freq.biweekly');
    case 'semimonthly': return t('onboarding.form.freq.semimonthly');
    case 'monthly': return t('onboarding.form.freq.monthly');
  }
}

function PayDates({
  items,
  runner,
  onDone,
}: {
  items: PayDateItem[];
  runner: ReturnType<typeof createOnboardingRunner>;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [inputs, setInputs] = useState<Record<string, PayDateInput>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { nextPayDate: '', day1: '', day2: '30' }]))
  );
  const [status, setStatus] = useState<Record<string, { state: 'idle' | 'saving' | 'saved' | 'error'; messageKey?: string; values?: Record<string, number> }>>({});
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [today, setToday] = useState<string | null>(null);

  const saveOne = async (item: PayDateItem) => {
    setStatus((s) => ({ ...s, [item.id]: { state: 'saving' } }));
    let day = today;
    if (!day) {
      // The household's today, for "next payday within 7/14 days".
      try {
        day = await runner.householdToday();
        setToday(day);
      } catch (err) {
        console.error('Pay dates timezone error:', err);
        setStatus((s) => ({ ...s, [item.id]: { state: 'error', messageKey: 'errors.server' } }));
        return;
      }
    }
    const result = await runner.savePayDate(item, inputs[item.id], day);
    setStatus((s) => ({
      ...s,
      [item.id]: result.ok ? { state: 'saved' } : { state: 'error', messageKey: result.messageKey, values: result.values },
    }));
  };

  const unsaved = items.filter((i) => status[i.id]?.state !== 'saved').length;

  return (
    <>
      <Text style={styles.title}>{t('onboarding.payDates.title')}</Text>
      <Text style={styles.hint}>{t('onboarding.payDates.subtitle')}</Text>
      {items.map((item) => {
        const input = inputs[item.id];
        const st = status[item.id];
        const set = (patch: Partial<PayDateInput>) => setInputs((all) => ({ ...all, [item.id]: { ...all[item.id], ...patch } }));
        return (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.description}</Text>
            <Text style={styles.small}>
              {formatCADLocale(item.amount, locale)} · {cadenceLabel(t, item.cadence)}
            </Text>
            {st?.state === 'saved' ? (
              <Text style={styles.saved}>{t('onboarding.payDates.saved')}</Text>
            ) : item.cadence === 'semimonthly' ? (
              <>
                <Text style={styles.label}>{t('onboarding.payDates.day1Label')}</Text>
                <TextInput style={styles.input} value={input.day1} onChangeText={(v) => set({ day1: v })} keyboardType="number-pad" accessibilityLabel={t('onboarding.payDates.day1Label')} />
                <Text style={styles.label}>{t('onboarding.payDates.day2Label')}</Text>
                <TextInput style={styles.input} value={input.day2} onChangeText={(v) => set({ day2: v })} keyboardType="number-pad" accessibilityLabel={t('onboarding.payDates.day2Label')} />
                <Text style={styles.small}>{t('onboarding.payDates.shortMonthNote')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>{t('onboarding.payDates.nextPayDateLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={input.nextPayDate}
                  onChangeText={(v) => set({ nextPayDate: v })}
                  keyboardType="numbers-and-punctuation"
                  placeholder={t('entry.datePlaceholder')}
                  accessibilityLabel={t('onboarding.payDates.nextPayDateLabel')}
                />
                <Text style={styles.small}>
                  {t('onboarding.payDates.nextPayDateWindow', { days: item.cadence === 'weekly' ? 7 : 14 })}
                </Text>
              </>
            )}
            {st?.state === 'error' && st.messageKey && <ErrorBox text={t(st.messageKey, st.values)} />}
            {st?.state !== 'saved' && (
              <SecondaryButton
                label={st?.state === 'saving' ? t('onboarding.payDates.saving') : t('onboarding.payDates.save')}
                onPress={() => void saveOne(item)}
                disabled={st?.state === 'saving'}
              />
            )}
          </View>
        );
      })}

      {confirmSkip && unsaved > 0 && <Text style={styles.body}>{t('onboarding.payDates.confirmSkip')}</Text>}
      <PrimaryButton
        label={confirmSkip && unsaved > 0 ? t('onboarding.payDates.continueAnyway') : t('onboarding.payDates.continue')}
        onPress={() => {
          // Leaving with dates unset is allowed, but asked about once.
          if (unsaved > 0 && !confirmSkip) setConfirmSkip(true);
          else onDone();
        }}
      />
      <Text style={styles.small}>{t('onboarding.payDates.skipNote')}</Text>
    </>
  );
}

function cadenceLabel(t: (k: string) => string, cadence: string): string {
  switch (cadence) {
    case 'weekly': return t('onboarding.form.freq.weekly');
    case 'biweekly': return t('onboarding.form.freq.biweekly');
    case 'semimonthly': return t('onboarding.form.freq.semimonthly');
    default: return cadence;
  }
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.small}>{hint}</Text>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
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

function ErrorBox({ text }: { text: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.secondary, (pressed || disabled) && styles.pressed]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  flex: { flex: 1 },
  content: { padding: theme.space.md, gap: theme.space.sm, paddingBottom: theme.space.xl },
  centred: { alignItems: 'center', justifyContent: 'center', gap: theme.space.md, paddingTop: 120 },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading, paddingHorizontal: theme.space.xs },
  hint: { fontSize: 15, lineHeight: 22, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  body: { fontSize: 15, lineHeight: 23, color: theme.color.body, paddingHorizontal: theme.space.xs },
  small: { fontSize: 13, lineHeight: 19, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  label: { fontSize: 13, fontWeight: '600', color: theme.color.muted, marginTop: theme.space.sm, paddingHorizontal: theme.space.xs },
  section: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
    marginTop: theme.space.sm,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: theme.color.heading },
  lines: { gap: theme.space.md },
  line: { gap: theme.space.sm },
  lineProblem: { borderLeftWidth: 3, borderLeftColor: theme.color.danger, paddingLeft: theme.space.sm },
  monthly: { fontSize: 13, color: theme.color.accent, paddingHorizontal: theme.space.xs },
  link: { fontSize: 15, fontWeight: '600', color: theme.color.accent },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.color.body,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  chip: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: theme.color.surface,
  },
  chipSelected: { borderColor: theme.color.accent, backgroundColor: theme.color.accentSurface },
  chipText: { fontSize: 13, color: theme.color.muted },
  chipTextSelected: { color: theme.color.heading, fontWeight: '600' },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.color.heading },
  cardText: { fontSize: 15, lineHeight: 22, color: theme.color.body },
  letter: { fontSize: 15, lineHeight: 23, color: theme.color.body },
  saved: { fontSize: 14, fontWeight: '600', color: theme.color.positive },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: 14, lineHeight: 20 },
  button: {
    backgroundColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: theme.color.surface },
  secondary: {
    borderWidth: 1.5,
    borderColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: theme.space.sm,
  },
  secondaryText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
  pressed: { opacity: 0.6 },
});
