'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

type NameState = {
  status: 'pending' | 'confirming' | 'confirmed' | 'declined';
  error: string;
};

/**
 * "Your file mentions Julia — part of your household?" — shown once per
 * unresolved Member name, before plan generation, so the plan is born with
 * correct attribution instead of being patched after saving.
 *
 * Confirm creates a name-only household_members row (POST quick-add — no
 * auth user, no email). Decline does nothing here; the existing
 * current-user fallback + unmatchedMembers banner in save-plan handles it
 * exactly as it already does for any other unresolved name.
 */
export default function MemberConfirmStep({
  names,
  onDone,
}: {
  names: string[];
  onDone: () => void;
}) {
  const t = useTranslations('upload.memberConfirm');
  const [state, setState] = useState<Record<string, NameState>>(() =>
    Object.fromEntries(names.map((n) => [n, { status: 'pending', error: '' }]))
  );

  const update = (name: string, patch: Partial<NameState>) =>
    setState((s) => ({ ...s, [name]: { ...s[name], ...patch } }));

  const confirm = async (name: string) => {
    update(name, { status: 'confirming', error: '' });
    try {
      const res = await fetch('/api/household/members/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add');
      update(name, { status: 'confirmed', error: '' });
    } catch (err) {
      update(name, { status: 'pending', error: err instanceof Error ? err.message : t('error') });
    }
  };

  const decline = (name: string) => {
    update(name, { status: 'declined', error: '' });
  };

  const allResolved = names.every((n) => state[n].status === 'confirmed' || state[n].status === 'declined');

  return (
    <div className="rounded-2xl bg-white p-8 space-y-6" style={{ border: '1px solid #E5E7EB' }}>
      <div>
        <p className="text-lg font-bold mb-1" style={{ color: '#0F2044' }}>{t('title')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        {names.map((name) => {
          const s = state[name];
          return (
            <div key={name} className="rounded-xl p-4" style={{ background: '#FAFAF8', border: '1px solid #E5E7EB' }}>
              <p className="font-medium mb-3" style={{ color: '#0F2044' }}>{t('question', { name })}</p>

              {s.status === 'confirmed' && (
                <p className="text-sm font-medium" style={{ color: '#16A34A' }}>{t('confirmedNote', { name })}</p>
              )}
              {s.status === 'declined' && (
                <p className="text-sm" style={{ color: '#6B7280' }}>{t('declinedNote')}</p>
              )}
              {(s.status === 'pending' || s.status === 'confirming') && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => confirm(name)}
                    disabled={s.status === 'confirming'}
                    className="px-4 py-1.5 rounded-full text-sm font-medium text-white cursor-pointer disabled:opacity-50"
                    style={{ background: '#0F2044' }}
                  >
                    {s.status === 'confirming' ? t('confirming') : t('confirmBtn')}
                  </button>
                  <button
                    onClick={() => decline(name)}
                    disabled={s.status === 'confirming'}
                    className="px-4 py-1.5 rounded-full text-sm font-medium cursor-pointer disabled:opacity-50"
                    style={{ border: '1.5px solid #D1D5DB', color: '#6B7280' }}
                  >
                    {t('declineBtn')}
                  </button>
                </div>
              )}
              {s.error && <p className="text-sm mt-2" style={{ color: '#DC2626' }}>{s.error}</p>}
            </div>
          );
        })}
      </div>

      <div className="text-center pt-2">
        <button
          onClick={onDone}
          disabled={!allResolved}
          className="px-6 py-2.5 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-40"
          style={{ background: '#0F2044', color: 'white' }}
        >
          {t('continue')}
        </button>
      </div>
    </div>
  );
}
