'use client';

// The one contribution-rule editor, shared by the Reserve Fund and Goals
// halves of /savings (2026-08-31). Lifted out of ReserveFundSection, where
// it was the only forward-apply editor in the product — Goals had no way to
// change a rule at all, so households edited each materialized row by hand
// instead, which detaches every one of them from its rule.
//
// It edits the RULE, never a row. PATCH /api/recurring/[id] decides what
// that means: an amount/cadence/anchor change takes the split path, which
// freezes the current rule as history, deletes only its rows dated on or
// after the effective boundary, and materializes a new rule forward from
// there. Contributions already made keep their real amount and date — that
// guarantee lives in the route (it rejects an effectiveFrom in the past),
// not in this form.
//
// The form deliberately does NOT expose the effective date. Both surfaces
// promise "starting next month" in words, and the route's default is
// firstOfNextMonth. The /recurring page is where a household picks a
// different boundary; giving them two ways to set it here would mean two
// places to keep honest.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { anchorDayOfMonth, anchorDateForDayOfMonth, sameAnchorSchedule } from '@phare/core';

export type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

// For monthly/semimonthly the schedule is a DAY, and only the day is ever
// read back out of the anchor — so that's what the household picks. For
// weekly/biweekly the anchor's full date sets the phase (every 7/14 days
// counted from it), so those need a real date instead.
export const usesDayOfMonth = (cadence: Cadence) =>
  cadence === 'monthly' || cadence === 'semimonthly';

export default function ContributionEditor({
  recurringItemId,
  currentAmount,
  cadence: currentCadence,
  anchorDate: currentAnchorDate,
  secondDay: currentSecondDay,
  tombstonesAfterBoundary,
  today,
  onSaved,
  onCancel,
}: {
  recurringItemId: string;
  currentAmount: number;
  cadence: Cadence | null;
  anchorDate: string | null;
  secondDay: number | null;
  /** Detached occurrences dated on/after the boundary a schedule move would
   *  use. Drives the confirm-once warning; 0 means nothing to warn about. */
  tombstonesAfterBoundary: number;
  today: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('contributionEditor');

  const [amount, setAmount] = useState(String(currentAmount));
  const [cadence, setCadence] = useState<Cadence>(currentCadence ?? 'monthly');
  const [secondDay, setSecondDay] = useState(String(currentSecondDay ?? '30'));
  // Two shapes for the same field — see usesDayOfMonth above. Both are
  // seeded from the one stored anchor, so switching cadence inside the form
  // doesn't land on an empty field. Only the one matching the currently
  // selected cadence is ever sent.
  const [anchorDay, setAnchorDay] = useState(
    currentAnchorDate ? String(anchorDayOfMonth(currentAnchorDate)) : ''
  );
  const [anchorDate, setAnchorDate] = useState(currentAnchorDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Set when a save would move the schedule while detached occurrences exist
  // past the boundary. Shows the warning and turns Save into an explicit
  // confirm — the household can proceed, they just aren't surprised by it.
  const [scheduleWarning, setScheduleWarning] = useState(false);

  const inputStyle = { border: '1px solid #D1D5DB', color: '#0F2044' };

  // The anchor this form would send, in the shape the selected cadence
  // needs. null means "leave it alone" — the PATCH route falls back to the
  // rule's current anchor when anchorDate is absent.
  function resolveAnchorDate(): string | null {
    if (usesDayOfMonth(cadence)) {
      const day = parseInt(anchorDay, 10);
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      return anchorDateForDayOfMonth(day, today);
    }
    return anchorDate || null;
  }

  async function save(confirmedSchedule = false) {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      setError(t('amountInvalid'));
      return;
    }
    if (usesDayOfMonth(cadence) && anchorDay !== '') {
      const day = parseInt(anchorDay, 10);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        setError(t('dayInvalid'));
        return;
      }
    }

    const resolvedAnchor = resolveAnchorDate();

    // Warn ONLY when the schedule actually moves. An amount-only change also
    // splits the rule, but dates don't move under it, so the tombstone
    // carry-forward lands exactly where it should and there is nothing to
    // warn about — firing here too would be noise that trains people to
    // click through.
    const scheduleMoved =
      cadence !== (currentCadence ?? 'monthly') ||
      !sameAnchorSchedule(resolvedAnchor, currentAnchorDate, cadence);
    if (scheduleMoved && tombstonesAfterBoundary > 0 && !confirmedSchedule) {
      setScheduleWarning(true);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/recurring/${recurringItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsed,
          cadence,
          secondDay: cadence === 'semimonthly' ? parseInt(secondDay, 10) : null,
          ...(resolvedAnchor ? { anchorDate: resolvedAnchor } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-32 px-2 py-1.5 rounded text-sm outline-none"
        style={inputStyle}
      />
      <select
        value={cadence}
        onChange={(e) => setCadence(e.target.value as Cadence)}
        className="px-2 py-1.5 rounded text-sm outline-none bg-white"
        style={inputStyle}
      >
        <option value="monthly">{t('cadenceMonthly')}</option>
        <option value="biweekly">{t('cadenceBiweekly')}</option>
        <option value="semimonthly">{t('cadenceSemimonthly')}</option>
        <option value="weekly">{t('cadenceWeekly')}</option>
      </select>
      {/* When the contribution comes out. A day-of-month for
          monthly/semimonthly (only the day is ever read back); a real date
          for weekly/biweekly, where the anchor sets the phase. */}
      {usesDayOfMonth(cadence) ? (
        <span className="flex items-center gap-1.5">
          <label className="text-xs" style={{ color: '#6B7280' }}>{t('contributionDayLabel')}</label>
          <input
            type="number"
            min="1"
            max="31"
            value={anchorDay}
            onChange={(e) => setAnchorDay(e.target.value)}
            className="w-16 px-2 py-1.5 rounded text-sm outline-none"
            style={inputStyle}
          />
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <label className="text-xs" style={{ color: '#6B7280' }}>{t('firstDateLabel')}</label>
          <input
            type="date"
            value={anchorDate}
            onChange={(e) => setAnchorDate(e.target.value)}
            className="px-2 py-1.5 rounded text-sm outline-none bg-white"
            style={inputStyle}
          />
        </span>
      )}
      {cadence === 'semimonthly' && (
        <span className="flex items-center gap-1.5">
          <label className="text-xs" style={{ color: '#6B7280' }}>{t('secondDay')}</label>
          <input
            type="number"
            min="1"
            max="31"
            value={secondDay}
            onChange={(e) => setSecondDay(e.target.value)}
            className="w-16 px-2 py-1.5 rounded text-sm outline-none"
            style={inputStyle}
          />
        </span>
      )}
      <button
        onClick={() => save(scheduleWarning)}
        disabled={saving}
        className="px-3 py-1.5 rounded text-sm font-medium text-white cursor-pointer disabled:opacity-50"
        style={{ background: scheduleWarning ? '#B45309' : '#2ABFBF' }}
      >
        {saving ? t('saving') : scheduleWarning ? t('confirmAnyway') : t('save')}
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded text-sm cursor-pointer"
        style={{ color: '#6B7280' }}
      >
        {t('cancel')}
      </button>
      {error && <p className="w-full text-sm" style={{ color: '#DC2626' }}>{error}</p>}
      {/* Detached-occurrence warning — shown only when this save would move
          the schedule AND singles were edited or removed past the boundary.
          They can proceed; the point is that they aren't surprised after. */}
      {scheduleWarning && (
        <div className="w-full rounded-xl p-3 space-y-1" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <p className="text-sm font-semibold" style={{ color: '#92400E' }}>{t('scheduleWarningTitle')}</p>
          <p className="text-xs" style={{ color: '#92400E' }}>
            {t('scheduleWarningBody', { count: tombstonesAfterBoundary })}
          </p>
        </div>
      )}
      <p className="w-full text-xs" style={{ color: '#9CA3AF' }}>
        {usesDayOfMonth(cadence) ? `${t('contributionDayHint')} ` : `${t('firstDateHint')} `}
        {t('effectiveNote')}
      </p>
    </div>
  );
}
