'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransactionExport } from '@/components/shared/useTransactionExport';

/**
 * The deletion surface, for both cases.
 *
 * Design rules this encodes, all of them deliberate:
 *
 *  - THE EXPORT IS THE PRIMARY ACTION. On the one screen where a family is
 *    about to destroy years of records, the visually loudest control is the one
 *    that saves them, not the one that deletes them. The delete button is
 *    outlined and quiet; "download first" is filled.
 *  - THE BLAST RADIUS IS READ FROM THE DATABASE, never guessed or hardcoded.
 *  - NO UNDO, NO GRACE PERIOD, SAID OUT LOUD. Products usually bury this. It is
 *    stated as its own line, in both the API response and here.
 *  - THE CONFIRMATION PHRASE IS SPECIFIC: your household's name, or your own
 *    email. Never "DELETE" — a generic word reads identically on every screen
 *    and can be typed without reading.
 *  - BLOCKED IS NOT A DEAD END. When the last owner can't leave, the block
 *    names the person to promote and points at the control directly above.
 *  - THE ESCAPE HATCH TAKES TWO SEPARATE GATES. Acknowledging that no one can
 *    take over is one decision; typing the household name is another.
 */

type Verdict =
  | { mode: 'self_delete' }
  | { mode: 'household_delete'; reason: 'sole_member' | 'all_pending' }
  | { mode: 'blocked_promote'; candidates: { id: string; name?: string }[] }
  | { mode: 'blocked_no_path' };

type Preview = {
  verdict: Verdict;
  householdName: string | null;
  blastRadius: {
    members: number;
    accounts: number;
    transactions: number;
    recurringItems: number;
    sinkingFunds: number;
    reviews: number;
    monthsOfHistory: number;
    earliestDate: string | null;
  } | null;
  confirmWith: { field: 'confirmHouseholdName' | 'confirmEmail'; phrase: string | null };
};

export default function DeleteAccountSection({ locale }: { locale: string }) {
  const t = useTranslations('deleteAccount');
  const tExport = useTranslations('exportData');
  const router = useRouter();

  const { download, downloading, downloaded, error: exportError } = useTransactionExport(locale);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [hatchAcknowledged, setHatchAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/household/deletion-preview')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) { setPreview(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl bg-white p-6" style={{ border: '1px solid #E5E7EB' }}>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('loading')}</p>
      </section>
    );
  }
  if (!preview) return null;

  const { verdict, blastRadius, confirmWith, householdName } = preview;
  const isHousehold = verdict.mode === 'household_delete';
  const blocked = verdict.mode === 'blocked_promote' || verdict.mode === 'blocked_no_path';

  // --- blocked: name the way forward, never just refuse --------------------
  if (blocked) {
    return (
      <section className="rounded-2xl bg-white p-6 space-y-3" style={{ border: '1px solid #E5E7EB' }}>
        <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('title')}</h2>
        <div className="rounded-xl p-4" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
          <p className="text-sm font-medium" style={{ color: '#92400E' }}>{t('blockedTitle')}</p>
          <p className="text-sm mt-1" style={{ color: '#92400E' }}>
            {verdict.mode === 'blocked_promote'
              ? t('blockedPromoteBody', {
                  names: verdict.candidates.map((c) => c.name ?? '').filter(Boolean).join(', '),
                })
              : t('blockedNoPathBody')}
          </p>
        </div>
      </section>
    );
  }

  const phrase = confirmWith.phrase ?? '';
  const phraseMatches = typed.trim().toLowerCase() === phrase.trim().toLowerCase() && phrase.length > 0;
  // The escape hatch's first gate. Only ever required for all_pending — a sole
  // member has nobody to hand the household to by definition, so asking them to
  // acknowledge it would be noise.
  const needsHatchGate = isHousehold && verdict.reason === 'all_pending';
  const gatePassed = !needsHatchGate || hatchAcknowledged;

  const handleDelete = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(isHousehold ? '/api/household' : '/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [confirmWith.field]: typed.trim() }),
      });
      const json = await res.json().catch(() => null);

      if (res.ok || res.status === 202) {
        // Both outcomes end the session. 202 means the erasure is still
        // finishing server-side; either way this account no longer has access,
        // so staying on an authenticated page would only render errors.
        router.push(`/${locale}/signin`);
        return;
      }
      setError(json?.error ?? t('failed'));
    } catch {
      setError(t('failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-6 space-y-4" style={{ border: '1px solid #FECACA' }}>
      <div>
        <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('title')}</h2>
        <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
          {isHousehold
            ? (verdict.reason === 'sole_member' ? t('soleMemberBody') : t('allPendingBody'))
            : t('selfBody')}
        </p>
      </div>

      {/* Save your data first — the loudest control on this card, on purpose. */}
      <div className="rounded-xl p-4 space-y-2" style={{ background: '#F0FDFD', border: '1px solid #99F6E4' }}>
        <p className="text-sm font-medium" style={{ color: '#0F766E' }}>{t('exportFirstTitle')}</p>
        <p className="text-sm" style={{ color: '#0F766E' }}>{t('exportFirstBody')}</p>
        {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        <button
          onClick={download}
          disabled={downloading}
          className="px-6 py-2.5 rounded-full text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
          style={{ background: '#0F766E' }}
        >
          {downloading ? tExport('preparing') : downloaded ? t('exportAgain') : tExport('button')}
        </button>
      </div>

      {/* What will be destroyed, counted by the database. */}
      {isHousehold && blastRadius && (
        <div className="rounded-xl p-4" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <p className="text-sm font-medium" style={{ color: '#991B1B' }}>
            {t('blastTitle', { household: householdName ?? '' })}
          </p>
          <ul className="text-sm mt-2 space-y-0.5" style={{ color: '#991B1B' }}>
            <li>{t('blastTransactions', { count: blastRadius.transactions })}</li>
            <li>{t('blastMonths', { count: blastRadius.monthsOfHistory })}</li>
            <li>{t('blastAccounts', { count: blastRadius.accounts })}</li>
            <li>{t('blastRecurring', { count: blastRadius.recurringItems })}</li>
            <li>{t('blastFunds', { count: blastRadius.sinkingFunds })}</li>
            <li>{t('blastReviews', { count: blastRadius.reviews })}</li>
            <li>{t('blastMembers', { count: blastRadius.members })}</li>
          </ul>
        </div>
      )}

      {/* Said plainly, not buried. */}
      <p className="text-sm font-medium" style={{ color: '#991B1B' }}>{t('noUndo')}</p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all"
          style={{ border: '1.5px solid #DC2626', color: '#DC2626', background: 'white' }}
        >
          {isHousehold ? t('startHouseholdDelete') : t('startSelfDelete')}
        </button>
      ) : (
        <div className="space-y-3">
          {/* Gate 1 of 2, escape hatch only. */}
          {needsHatchGate && (
            <label className="flex items-start gap-2 text-sm" style={{ color: '#991B1B' }}>
              <input
                type="checkbox"
                checked={hatchAcknowledged}
                onChange={(e) => setHatchAcknowledged(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <span>{t('hatchAcknowledge')}</span>
            </label>
          )}

          {/* Gate 2: type the specific phrase. */}
          <div className={gatePassed ? '' : 'opacity-50 pointer-events-none'}>
            <label className="block text-sm mb-1" style={{ color: '#0F2044' }}>
              {isHousehold ? t('typeHouseholdName') : t('typeYourEmail')}
            </label>
            <p className="text-sm font-mono mb-2 px-3 py-1.5 rounded" style={{ background: '#F3F4F6', color: '#0F2044' }}>
              {phrase}
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-xl text-sm"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDelete}
              disabled={!phraseMatches || !gatePassed || submitting}
              className="px-6 py-2.5 rounded-full text-sm font-medium text-white cursor-pointer hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#DC2626' }}
            >
              {submitting ? t('deleting') : isHousehold ? t('confirmHouseholdDelete') : t('confirmSelfDelete')}
            </button>
            <button
              onClick={() => { setOpen(false); setTyped(''); setHatchAcknowledged(false); setError(''); }}
              className="px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer hover:opacity-80 transition-all"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
