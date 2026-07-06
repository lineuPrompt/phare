'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCAD } from './types';
import { validateNextPayDate, validateSemimonthlyDays, buildSemimonthlyAnchor } from '@/lib/anchorDateHelpers';
import { formatLocalDate, formatLocalMonth } from '@/lib/dateHelpers';

export type NeedsPayDateItem = {
  id: string;
  description: string;
  cadence: string;   // 'biweekly' | 'semimonthly' | 'weekly' (monthly never appears here)
  amount: number;
  member: string | null;
};

type ItemState = {
  nextPayDate: string;
  day1: string;
  day2: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
};

export default function AnchorDateStep({
  items,
  onDone,
}: {
  items: NeedsPayDateItem[];
  onDone: () => void;
}) {
  const t = useTranslations('upload.plan.anchorStep');
  const today = formatLocalDate(new Date());
  const currentMonth = formatLocalMonth(new Date());

  const [state, setState] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { nextPayDate: '', day1: '', day2: '30', status: 'idle', error: '' }]))
  );

  const update = (id: string, patch: Partial<ItemState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const saveItem = async (item: NeedsPayDateItem) => {
    const s = state[item.id];
    let anchorDate: string;
    let secondDay: number | null = null;

    if (item.cadence === 'semimonthly') {
      const day1 = parseInt(s.day1, 10);
      const day2 = parseInt(s.day2, 10);
      const check = validateSemimonthlyDays(day1, day2);
      if (!check.ok) {
        update(item.id, { status: 'error', error: t(`error.${check.error}`) });
        return;
      }
      const built = buildSemimonthlyAnchor(currentMonth, day1, day2);
      anchorDate = built.anchorDate;
      secondDay = built.secondDay;
    } else {
      const cadence = item.cadence as 'weekly' | 'biweekly';
      const check = validateNextPayDate(s.nextPayDate, cadence, today);
      if (!check.ok) {
        update(item.id, { status: 'error', error: t(`error.${check.error}`, { days: cadence === 'weekly' ? 7 : 14 }) });
        return;
      }
      anchorDate = s.nextPayDate;
    }

    update(item.id, { status: 'saving', error: '' });
    try {
      const res = await fetch(`/api/recurring/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchorDate, secondDay }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      update(item.id, { status: 'saved', error: '' });
    } catch (err) {
      update(item.id, { status: 'error', error: err instanceof Error ? err.message : t('error.generic') });
    }
  };

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };

  return (
    <div className="rounded-2xl bg-white p-8 space-y-6" style={{ border: '1px solid #E5E7EB' }}>
      <div>
        <p className="text-lg font-bold mb-1" style={{ color: '#0F2044' }}>{t('title')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const s = state[item.id];
          const label = item.member ? `${item.description} — ${item.member}` : item.description;
          return (
            <div key={item.id} className="rounded-xl p-4" style={{ background: '#FAFAF8', border: '1px solid #E5E7EB' }}>
              <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{label}</p>
              <p className="text-xs mb-3" style={{ color: '#9CA3AF' }}>
                {t(`cadence.${item.cadence}`)} · {formatCAD(item.amount)}{t('perPaycheque')}
              </p>

              {s.status === 'saved' ? (
                <p className="text-sm font-medium" style={{ color: '#16A34A' }}>{t('savedConfirm')}</p>
              ) : item.cadence === 'semimonthly' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm" style={{ color: '#6B7280' }}>{t('day1Label')}</label>
                    <input type="number" min="1" max="31" value={s.day1}
                      onChange={(e) => update(item.id, { day1: e.target.value })}
                      className="w-20 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
                    <label className="text-sm" style={{ color: '#6B7280' }}>{t('day2Label')}</label>
                    <input type="number" min="1" max="31" value={s.day2}
                      onChange={(e) => update(item.id, { day2: e.target.value })}
                      className="w-20 px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
                  </div>
                  <p className="text-xs" style={{ color: '#9CA3AF' }}>{t('shortMonthNote')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm" style={{ color: '#6B7280' }}>{t('nextPayDateLabel')}</label>
                    <input type="date" value={s.nextPayDate}
                      onChange={(e) => update(item.id, { nextPayDate: e.target.value })}
                      className="px-3 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
                  </div>
                  <p className="text-xs" style={{ color: '#9CA3AF' }}>
                    {t('nextPayDateWindow', { days: item.cadence === 'weekly' ? 7 : 14 })}
                  </p>
                </div>
              )}

              {s.status === 'error' && <p className="text-sm mt-2" style={{ color: '#DC2626' }}>{s.error}</p>}

              {s.status !== 'saved' && (
                <button
                  onClick={() => saveItem(item)}
                  disabled={s.status === 'saving'}
                  className="mt-3 px-4 py-1.5 rounded-full text-sm font-medium text-white cursor-pointer disabled:opacity-50"
                  style={{ background: '#0F2044' }}
                >
                  {s.status === 'saving' ? t('saving') : t('setPayDate')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-center pt-2">
        <button onClick={onDone} className="px-6 py-2.5 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
          style={{ background: '#0F2044', color: 'white' }}>
          {t('continue')}
        </button>
        <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>{t('skipNote')}</p>
      </div>
    </div>
  );
}
