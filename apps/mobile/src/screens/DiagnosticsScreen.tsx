import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { businessToday, formatCAD, formatCADLocale } from '@phare/core';
import { TIMEZONE_PROBE } from '../lib/startupProbe';
import { apiPostUnauthenticated } from '../lib/api';
import { useI18n } from '../i18n';
import { theme } from '../theme';

// ---------------------------------------------------------------------------
// DEVELOPMENT DIAGNOSTICS — not a product surface.
//
// This screen exists because the one thing that cannot be settled anywhere but
// on a real device is whether Hermes honours Intl. packages/core/README.md
// says so at length and calls it a known open risk. Reasoning about it on a
// laptop produces an opinion; this produces an answer, in one screenshot.
//
// It renders the two questions the README poses, side by side:
//   1. Does Intl.DateTimeFormat apply `timeZone`?  (the dangerous one —
//      a silent failure that books transactions into the wrong month)
//   2. Does Intl.NumberFormat produce the right fr-CA form?  (cosmetic, but
//      wrong in the primary market)
//
// The fr-CA answer is shown as CODEPOINTS as well as glyphs, because the whole
// question is whether the separators are U+00A0 NO-BREAK SPACE or a plain
// U+0020 — and those two are visually identical on screen. money.test.ts pins
// the expected form to the codepoint for the same reason.
//
// Before this ships to anyone who is not building it, the route should be
// dropped or gated on __DEV__.
// ---------------------------------------------------------------------------

/** "1 234,50 $" → "U+0031 U+0020 U+0032 …", so U+00A0 vs U+0020 is visible. */
function codepoints(value: string): string {
  return Array.from(value)
    .map((char) => 'U+' + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
    .join(' ');
}

/**
 * The smallest body /api/review-stream accepts that still exercises the
 * allowlist projection. Field names match ProjectedReviewPlan in
 * src/lib/promptInputLimits.ts.
 */
const PROBE_PLAN = {
  plan: {
    monthlyBudget: {
      totalIncome: 8000,
      totalExpenses: 6000,
      totalSavings: 2000,
      categories: [
        {
          name: 'Groceries',
          budgeted: 800,
          type: 'expense',
          seedCategory: 'Groceries & Pharmacy',
          isFixed: false,
        },
      ],
    },
    seedCategories: ['Housing'],
    sinkingFunds: [],
    debtPayoff: null,
    goals: [],
    // Deliberately carries no dollar figure. The fixture's content is
    // irrelevant to what the probe proves, and a '$450/month' string here
    // would sit in the shipped binary looking exactly like the pricing copy
    // this app must not contain — making any future audit grep ambiguous.
    topRecommendation: 'Revisit the reserve fund contribution this month.',
  },
  analysis: { source: 'template' },
  locale: 'en',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function DiagnosticsScreen() {
  const { t, locale } = useI18n();
  const [probeState, setProbeState] = useState<
    { status: 'idle' } | { status: 'running' } | { status: 'done'; text: string }
  >({ status: 'idle' });

  const frFormatted = formatCADLocale(1234.5, 'fr');

  const runStreamProbe = async () => {
    setProbeState({ status: 'running' });
    try {
      // ?stream=0 — the flag that makes this route return one JSON body.
      // React Native's fetch does not populate response.body, so the default
      // streamed response is unreadable here; this call is the proof that the
      // non-streaming mode is what mobile needs.
      const body = await apiPostUnauthenticated<{ review: string }>(
        '/api/review-stream?stream=0',
        PROBE_PLAN
      );
      setProbeState({
        status: 'done',
        text: t('diagnostics.streamProbeOk', { chars: body.review.length }),
      });
    } catch (err) {
      setProbeState({
        status: 'done',
        text: t('diagnostics.streamProbeFailed', {
          reason: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('diagnostics.title')}</Text>
        <Text style={styles.subtitle}>{t('diagnostics.subtitle')}</Text>

        <Section title={t('diagnostics.timezoneHeading')}>
          <Text style={[styles.verdict, TIMEZONE_PROBE.ok ? styles.pass : styles.fail]}>
            {TIMEZONE_PROBE.ok
              ? t('diagnostics.timezonePassed')
              : t('diagnostics.timezoneFailed')}
          </Text>
          {!TIMEZONE_PROBE.ok && (
            <Text selectable style={styles.rowValue}>
              {TIMEZONE_PROBE.message}
            </Text>
          )}
        </Section>

        <Section title={t('diagnostics.moneyHeading')}>
          <Row label={t('diagnostics.formatCadLabel')} value={formatCAD(1234.5)} />
          <Row
            label={t('diagnostics.formatCadLocaleEnLabel')}
            value={formatCADLocale(1234.5, 'en')}
          />
          <Row label={t('diagnostics.formatCadLocaleFrLabel')} value={frFormatted} />
          <Row label={t('diagnostics.codepointsLabel')} value={codepoints(frFormatted)} />
          <Text style={styles.note}>{t('diagnostics.nbspExpected')}</Text>
        </Section>

        <Section title={t('diagnostics.dateHeading')}>
          <Row
            label={t('diagnostics.businessTodayLabel')}
            value={businessToday('America/Toronto')}
          />
        </Section>

        <Section title={t('diagnostics.deviceHeading')}>
          <Row label={t('diagnostics.localeLabel')} value={locale} />
          <Row label="Platform" value={`${Platform.OS} ${String(Platform.Version)}`} />
          <Row
            label="Intl.DateTimeFormat resolved zone"
            value={Intl.DateTimeFormat().resolvedOptions().timeZone ?? '(none)'}
          />
        </Section>

        <Section title={t('diagnostics.streamProbeHeading')}>
          <Text style={styles.note}>{t('diagnostics.streamProbeExplain')}</Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.button, probeState.status === 'running' && styles.buttonDisabled]}
            onPress={runStreamProbe}
            disabled={probeState.status === 'running'}
          >
            <Text style={styles.buttonText}>
              {probeState.status === 'running'
                ? t('diagnostics.streamProbeRunning')
                : t('diagnostics.streamProbeRun')}
            </Text>
          </Pressable>
          {probeState.status === 'done' && (
            <Text selectable style={styles.rowValue}>
              {probeState.text}
            </Text>
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  content: { padding: theme.space.md, gap: theme.space.md },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading },
  subtitle: { fontSize: 13, color: theme.color.muted },
  section: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: theme.color.heading },
  row: { gap: 2 },
  rowLabel: { fontSize: 12, color: theme.color.muted },
  rowValue: {
    fontSize: 14,
    color: theme.color.body,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  note: { fontSize: 12, color: theme.color.muted, lineHeight: 18 },
  verdict: { fontSize: 15, fontWeight: '700' },
  pass: { color: '#15803D' },
  fail: { color: theme.color.danger },
  button: {
    backgroundColor: theme.color.heading,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
