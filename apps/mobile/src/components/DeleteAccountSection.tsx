import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiDelete, apiGet, apiGetText, apiPost, messageKeyFor } from '../lib/api';
import {
  canDelete,
  deletionErrorKey,
  deletionOutcome,
  deletionRequest,
  exportPath,
  loadDeletionPreview,
  promoteMember,
  type DeletionPreview,
} from '../lib/accountDeletion';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Account deletion, both cases, on the Account tab.
 *
 * Rules carried over from the web section, each deliberate:
 *   - THE EXPORT COMES FIRST and is the loudest control; delete is outlined.
 *   - THE BLAST RADIUS IS THE DATABASE'S, read from the preview.
 *   - NO UNDO, SAID OUT LOUD.
 *   - THE PHRASE IS SPECIFIC: the household's name, or your own email.
 *   - THE ESCAPE HATCH TAKES TWO GATES.
 *
 * Mobile differences: the export is handed to the system share sheet as text
 * (no new native module); a blocked owner gets ONE control — promote — and
 * nothing else from household management; the blast radius is label/count
 * rows, because this app has no ICU plurals.
 */
export default function DeleteAccountSection() {
  const { t, locale } = useI18n();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [hatch, setHatch] = useState(false);
  const [busy, setBusy] = useState<'export' | 'delete' | 'promote' | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const fetchPreview = useCallback(async (): Promise<{ preview: DeletionPreview } | { errorKey: string }> => {
    try {
      return { preview: await loadDeletionPreview(apiGet) };
    } catch (err) {
      console.error('Deletion preview error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, []);

  const apply = useCallback((outcome: { preview: DeletionPreview } | { errorKey: string }) => {
    if ('preview' in outcome) {
      setPreview(outcome.preview);
      setLoadErrorKey(null);
    } else {
      setPreview(null);
      setLoadErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchPreview();
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPreview, apply]);

  const reload = async () => apply(await fetchPreview());

  const exportData = async () => {
    setBusy('export');
    setMessageKey(null);
    try {
      const csv = await apiGetText(exportPath(locale));
      const result = await Share.share({ message: csv, title: t('deletion.exportShareTitle') });
      if (result.action === Share.sharedAction) setExported(true);
    } catch (err) {
      console.error('Export error:', err);
      setMessageKey('deletion.exportFailed');
    } finally {
      setBusy(null);
    }
  };

  const promote = async (memberId: string) => {
    setBusy('promote');
    setMessageKey(null);
    const result = await promoteMember(apiPost, memberId);
    setBusy(null);
    if (!result.ok) {
      setMessageKey(result.messageKey);
      return;
    }
    // The verdict is the server's to recompute. Ask again rather than assume.
    await reload();
  };

  const remove = async () => {
    if (!preview) return;
    const { path, field } = deletionRequest(preview);
    setBusy('delete');
    setMessageKey(null);
    try {
      const { status } = await apiDelete(path, { [field]: typed.trim() });
      const outcome = deletionOutcome(status);
      // Access is already gone on the server (and, since fcc0957, refresh
      // tokens too). Local sign-out needs no network and cannot fail on a
      // revoked token the way a global one would.
      await supabase.auth.signOut({ scope: 'local' });
      Alert.alert(
        outcome === 'deleted' ? t('deletion.doneTitle') : t('deletion.partialTitle'),
        outcome === 'deleted'
          ? t('deletion.doneBody')
          : preview.verdict.mode === 'household_delete'
            ? t('deletion.partialHouseholdBody')
            : t('deletion.partialSelfBody')
      );
    } catch (err) {
      console.error('Deletion error:', err);
      setMessageKey(deletionErrorKey(err));
      setBusy(null);
    }
  };

  if (loadErrorKey) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{t('deletion.title')}</Text>
        <Text style={styles.error}>{t(loadErrorKey)}</Text>
        <Pressable accessibilityRole="button" onPress={() => void reload()} hitSlop={8}>
          <Text style={styles.link}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{t('deletion.title')}</Text>
        <ActivityIndicator color={theme.color.heading} />
      </View>
    );
  }

  const v = preview.verdict;

  if (v.mode === 'blocked_promote' || v.mode === 'blocked_no_path') {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>{t('deletion.title')}</Text>
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>{t('deletion.blockedTitle')}</Text>
          <Text style={styles.warningBody}>
            {v.mode === 'blocked_promote'
              ? t('deletion.blockedPromoteBody', {
                  names: v.candidates.map((c) => c.name ?? '').filter(Boolean).join(', '),
                })
              : t('deletion.blockedNoPathBody')}
          </Text>
        </View>
        {v.mode === 'blocked_promote' &&
          v.candidates.map((c) => (
            <SecondaryButton
              key={c.id}
              label={busy === 'promote' ? t('deletion.promoting') : t('deletion.promote', { name: c.name ?? '' })}
              onPress={() => void promote(c.id)}
              disabled={busy !== null}
            />
          ))}
        {messageKey && <Text style={styles.error}>{t(messageKey)}</Text>}
      </View>
    );
  }

  const isHousehold = v.mode === 'household_delete';
  const needsHatch = isHousehold && v.reason === 'all_pending';
  const b = preview.blastRadius;

  return (
    <View style={[styles.section, styles.danger]}>
      <Text style={styles.title}>{t('deletion.title')}</Text>
      <Text style={styles.body}>
        {isHousehold
          ? v.reason === 'sole_member' ? t('deletion.soleMemberBody') : t('deletion.allPendingBody')
          : t('deletion.selfBody')}
      </Text>

      {/* Save your data first — the loudest control here, on purpose. */}
      <View style={styles.exportBox}>
        <Text style={styles.exportTitle}>{t('deletion.exportFirstTitle')}</Text>
        <Text style={styles.exportBody}>{t('deletion.exportFirstBody')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void exportData()}
          disabled={busy !== null}
          style={({ pressed }) => [styles.exportButton, (pressed || busy === 'export') && styles.pressed]}
        >
          <Text style={styles.exportButtonText}>
            {busy === 'export' ? t('deletion.exportPreparing') : exported ? t('deletion.exportAgain') : t('deletion.exportButton')}
          </Text>
        </Pressable>
      </View>

      {isHousehold && b && (
        <View style={styles.blast}>
          <Text style={styles.blastTitle}>{t('deletion.blastTitle', { household: preview.householdName ?? '' })}</Text>
          <Row label={t('deletion.blast.transactions')} value={b.transactions} />
          <Row label={t('deletion.blast.months')} value={b.monthsOfHistory} />
          <Row label={t('deletion.blast.accounts')} value={b.accounts} />
          <Row label={t('deletion.blast.recurring')} value={b.recurringItems} />
          <Row label={t('deletion.blast.funds')} value={b.sinkingFunds} />
          <Row label={t('deletion.blast.reviews')} value={b.reviews} />
          <Row label={t('deletion.blast.members')} value={b.members} />
        </View>
      )}

      <Text style={styles.noUndo}>{t('deletion.noUndo')}</Text>

      {!open ? (
        <SecondaryButton
          danger
          label={isHousehold ? t('deletion.startHousehold') : t('deletion.startSelf')}
          onPress={() => setOpen(true)}
        />
      ) : (
        <View style={styles.confirm}>
          {needsHatch && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hatch }}
              onPress={() => setHatch((h) => !h)}
              style={styles.hatch}
            >
              <Text style={styles.checkbox}>{hatch ? '☑' : '☐'}</Text>
              <Text style={styles.hatchText}>{t('deletion.hatchAcknowledge')}</Text>
            </Pressable>
          )}

          <Text style={styles.label}>{isHousehold ? t('deletion.typeHouseholdName') : t('deletion.typeYourEmail')}</Text>
          <Text style={styles.phrase}>{preview.confirmWith.phrase ?? ''}</Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!needsHatch || hatch}
            accessibilityLabel={isHousehold ? t('deletion.typeHouseholdName') : t('deletion.typeYourEmail')}
          />

          {messageKey && <Text style={styles.error}>{t(messageKey)}</Text>}

          <Pressable
            accessibilityRole="button"
            onPress={() => void remove()}
            disabled={!canDelete(preview, typed, hatch) || busy !== null}
            style={[styles.deleteButton, (!canDelete(preview, typed, hatch) || busy !== null) && styles.disabled]}
          >
            <Text style={styles.deleteButtonText}>
              {busy === 'delete' ? t('deletion.deleting') : isHousehold ? t('deletion.confirmHousehold') : t('deletion.confirmSelf')}
            </Text>
          </Pressable>
          <SecondaryButton
            label={t('deletion.cancel')}
            onPress={() => {
              setOpen(false);
              setTyped('');
              setHatch(false);
              setMessageKey(null);
            }}
            disabled={busy === 'delete'}
          />
        </View>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  const { locale } = useI18n();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {/* Grouped per locale: "1 204" in French, "1,204" in English. */}
      <Text style={styles.rowValue}>{new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA').format(value)}</Text>
    </View>
  );
}

function SecondaryButton({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.secondary, danger && styles.secondaryDanger, (pressed || disabled) && styles.pressed]}
    >
      <Text style={[styles.secondaryText, danger && styles.secondaryDangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  danger: { borderColor: theme.color.dangerBorder },
  title: { fontSize: 17, fontWeight: '700', color: theme.color.heading },
  body: { fontSize: 14, lineHeight: 21, color: theme.color.muted },
  error: { fontSize: 14, color: theme.color.danger },
  link: { fontSize: 14, fontWeight: '700', color: theme.color.heading },
  warning: {
    backgroundColor: theme.color.warningSurface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  warningTitle: { fontSize: 14, fontWeight: '700', color: theme.color.warning },
  warningBody: { fontSize: 14, lineHeight: 21, color: theme.color.warning },
  exportBox: {
    backgroundColor: theme.color.accentSurface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  exportTitle: { fontSize: 14, fontWeight: '700', color: '#0F766E' },
  exportBody: { fontSize: 14, lineHeight: 21, color: '#0F766E' },
  exportButton: { backgroundColor: '#0F766E', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  exportButtonText: { fontSize: 15, fontWeight: '700', color: theme.color.surface },
  blast: {
    backgroundColor: theme.color.dangerSurface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  blastTitle: { fontSize: 14, fontWeight: '700', color: theme.color.danger, marginBottom: theme.space.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { fontSize: 14, color: theme.color.danger },
  rowValue: { fontSize: 14, fontWeight: '700', color: theme.color.danger },
  noUndo: { fontSize: 14, fontWeight: '600', color: theme.color.danger },
  confirm: { gap: theme.space.sm },
  hatch: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'flex-start' },
  checkbox: { fontSize: 20, color: theme.color.danger },
  hatchText: { flex: 1, fontSize: 14, lineHeight: 21, color: theme.color.danger },
  label: { fontSize: 13, fontWeight: '600', color: theme.color.heading },
  phrase: {
    fontSize: 14,
    fontFamily: 'Courier',
    backgroundColor: theme.color.background,
    color: theme.color.heading,
    padding: theme.space.sm,
    borderRadius: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.color.body,
  },
  deleteButton: { backgroundColor: theme.color.danger, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  deleteButtonText: { fontSize: 15, fontWeight: '700', color: theme.color.surface },
  disabled: { opacity: 0.4 },
  secondary: {
    borderWidth: 1.5,
    borderColor: theme.color.heading,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryDanger: { borderColor: theme.color.danger },
  secondaryText: { fontSize: 15, fontWeight: '600', color: theme.color.heading },
  secondaryDangerText: { color: theme.color.danger },
  pressed: { opacity: 0.6 },
});
