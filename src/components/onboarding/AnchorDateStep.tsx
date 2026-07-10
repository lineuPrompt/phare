'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCAD } from './types';
import { validateNextPayDate, validateSemimonthlyDays, buildSemimonthlyAnchor, evaluateSkipConfirmation, type SkipConfirmation } from '@/lib/anchorDateHelpers';
import { formatLocalDate, formatLocalMonth } from '@/lib/dateHelpers';

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** "3 bills and 2 income sources" — bills first, income second, "and" only when both are present. */
function buildSkipConfirmParts(t: Translator, confirmation: Extract<SkipConfirmation, { needed: true }>): string {
  const parts: string[] = [];
  if (confirmation.unsetExpenseCount > 0) parts.push(t('confirmSkip.bills', { count: confirmation.unsetExpenseCount }));
  if (confirmation.unsetIncomeCount > 0) parts.push(t('confirmSkip.income', { count: confirmation.unsetIncomeCount }));
  return parts.length === 2 ? `${parts[0]} ${t('confirmSkip.and')} ${parts[1]}` : parts[0];
}

export type NeedsPayDateItem = {
  id: string;
  description: string;
  cadence: string;   // 'biweekly' | 'semimonthly' | 'weekly' (monthly never appears here)
  amount: number;
  type: 'income' | 'expense';
  member: string | null;
  memberId: string | null;
  isHousehold: boolean;
  attemptedName: string | null;
};

// Sentinel dropdown value for household-level attribution — never collides
// with a real household_members uuid.
const HOUSEHOLD_VALUE = '__household__';

type ItemState = {
  nextPayDate: string;
  day1: string;
  day2: string;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
  memberValue: string;
};

export default function AnchorDateStep({
  items,
  members,
  onDone,
}: {
  items: NeedsPayDateItem[];
  members: { id: string; name: string }[];
  // Reports the ids of items that actually got a real date set (status
  // 'saved'), so the caller can drop them from any "awaiting dates" count
  // it's holding — items left unresolved (skipped/declined) stay counted.
  onDone: (resolvedIds: string[]) => void;
}) {
  const t = useTranslations('upload.plan.anchorStep');
  const today = formatLocalDate(new Date());
  const currentMonth = formatLocalMonth(new Date());

  const [state, setState] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(items.map((i) => [
      i.id,
      {
        nextPayDate: '', day1: '', day2: '30', status: 'idle', error: '',
        memberValue: i.isHousehold ? HOUSEHOLD_VALUE : (i.memberId ?? ''),
      },
    ]))
  );
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  // This step auto-advances straight out of review-streaming with no pause —
  // a user mid-scroll on the plan review can land here without registering
  // a screen change. Bring it into view on mount so the transition is
  // impossible to miss, on top of its own distinct heading.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const update = (id: string, patch: Partial<ItemState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const skipConfirmation = evaluateSkipConfirmation(
    items.map((i) => ({ type: i.type, isSet: state[i.id]?.status === 'saved' }))
  );

  const resolvedIds = () => items.filter((i) => state[i.id]?.status === 'saved').map((i) => i.id);

  const handleContinueClick = () => {
    if (skipConfirmation.needed) {
      setShowSkipConfirm(true);
    } else {
      onDone(resolvedIds());
    }
  };

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
      const memberId = s.memberValue === HOUSEHOLD_VALUE ? null : (s.memberValue || null);
      const res = await fetch(`/api/recurring/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchorDate, secondDay, memberId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      update(item.id, { status: 'saved', error: '' });
    } catch (err) {
      update(item.id, { status: 'error', error: err instanceof Error ? err.message : t('error.generic') });
    }
  };

  const inputStyle = { border: '1.5px solid #D1D5DB', color: '#0F2044' };

  return (
    <div ref={rootRef} className="rounded-2xl bg-white p-8 space-y-6" style={{ border: '1px solid #E5E7EB' }}>
      <div>
        <p className="text-lg font-bold mb-1" style={{ color: '#0F2044' }}>{t('title')}</p>
        <p className="text-sm" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const s = state[item.id];
          return (
            <div key={item.id} className="rounded-xl p-4" style={{ background: '#FAFAF8', border: '1px solid #E5E7EB' }}>
              <p className="font-medium mb-1" style={{ color: '#0F2044' }}>{item.description}</p>
              <p className="text-xs mb-3" style={{ color: '#9CA3AF' }}>
                {t(`cadence.${item.cadence}`)} · {formatCAD(item.amount)}{t(item.type === 'income' ? 'perPaycheque' : 'perPayment')}
              </p>

              {item.attemptedName && (
                <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
                  {t('fallbackFlag', { name: item.attemptedName })}
                </p>
              )}

              {s.status !== 'saved' && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <label className="text-sm" style={{ color: '#6B7280' }}>{t('memberLabel')}</label>
                  <select
                    value={s.memberValue}
                    onChange={(e) => update(item.id, { memberValue: e.target.value })}
                    className="px-3 py-1.5 rounded-lg text-sm outline-none"
                    style={inputStyle}
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                    <option value={HOUSEHOLD_VALUE}>{t('householdOption')}</option>
                  </select>
                </div>
              )}

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

      {showSkipConfirm && skipConfirmation.needed && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: '#FFFBEB', border: '1.5px solid #F5A623' }}>
          <p className="text-sm" style={{ color: '#92400E' }}>
            {t('confirmSkip.message', { parts: buildSkipConfirmParts(t, skipConfirmation) })}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => setShowSkipConfirm(false)}
              className="flex-1 px-4 py-2 rounded-full text-sm font-semibold cursor-pointer hover:opacity-90 transition-all"
              style={{ background: '#0F2044', color: 'white' }}
            >
              {t('confirmSkip.setDates')}
            </button>
            <button
              onClick={() => onDone(resolvedIds())}
              className="flex-1 px-4 py-2 rounded-full text-sm font-medium cursor-pointer"
              style={{ border: '1.5px solid #92400E', color: '#92400E' }}
            >
              {t('confirmSkip.continueAnyway')}
            </button>
          </div>
        </div>
      )}

      <div className="text-center pt-2">
        <button onClick={handleContinueClick} className="px-6 py-2.5 rounded-full font-semibold cursor-pointer hover:opacity-90 transition-all"
          style={{ background: '#0F2044', color: 'white' }}>
          {t('continue')}
        </button>
        <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>{t('skipNote')}</p>
      </div>
    </div>
  );
}
