'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCurrency, formatSignedAmount } from '@/components/expenses/types';
import { EnvelopeStatus, envelopeStatus, sumWarning, CategoryEntryLine, UNCATEGORIZED_ROW_ID } from '@/lib/envelopeHelpers';

export type EnvelopeItem = {
  categoryId: string;
  categoryName: string;
  monthlyAmount: number;
  actual: number;
  remaining: number;
  status: EnvelopeStatus;
};

export type DecisionViewProps = {
  totalGoal: number | null;
  totalSpent: number;
  envelopeItems: EnvelopeItem[];
  uncategorized: number;
  entriesByCategory: Record<string, CategoryEntryLine[]>;
  uncategorizedEntries: CategoryEntryLine[];
  locale: string;
  onEditEnvelope: () => void;
  onEntryChanged: () => void;
};

// One entry line inside a category's accordion — view mode, or an inline
// edit form (date/description/amount), plus delete with a confirm step.
function EntryLine({ entry, locale, onChanged }: { entry: CategoryEntryLine; locale: string; onChanged: () => void }) {
  const t = useTranslations('cards.decision.entries');
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [date, setDate] = useState(entry.date);
  const [description, setDescription] = useState(entry.description ?? '');
  const [amount, setAmount] = useState(String(entry.amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const signed = formatSignedAmount(entry.amount, entry.type, locale);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/expenses/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, description: description.trim(), amount: parseFloat(amount) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1.5 px-2 rounded-lg" style={{ background: '#F9FAFB' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-24 px-2 py-1 rounded text-xs outline-none" style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }} />
        <button onClick={save} disabled={saving} className="text-xs font-semibold px-2 py-1 rounded cursor-pointer disabled:opacity-50" style={{ background: '#2ABFBF', color: '#0F2044' }}>
          {saving ? t('saving') : t('save')}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 rounded cursor-pointer" style={{ color: '#6B7280' }}>
          {t('cancel')}
        </button>
        {error && <p className="w-full text-xs" style={{ color: '#DC2626' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-1.5 px-2">
      <span className="text-xs w-24 shrink-0" style={{ color: '#9CA3AF' }}>{entry.date}</span>
      <span className="flex-1 min-w-0 truncate text-xs" style={{ color: '#374151' }}>
        {entry.description ?? '—'}
        {entry.installmentLabel && (
          <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#F0FDFD', color: '#2ABFBF' }}>{entry.installmentLabel}</span>
        )}
      </span>
      <span className="text-xs font-medium w-20 text-right shrink-0" style={{ color: signed.color }}>{signed.text}</span>
      {!confirmingDelete ? (
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditing(true)} className="text-xs cursor-pointer" style={{ color: '#2ABFBF' }}>{t('edit')}</button>
          <button onClick={() => setConfirmingDelete(true)} className="text-xs cursor-pointer" style={{ color: '#DC2626' }}>{t('delete')}</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: '#DC2626' }}>{t('confirmDelete')}</span>
          <button onClick={remove} disabled={saving} className="text-xs font-semibold cursor-pointer disabled:opacity-50" style={{ color: '#DC2626' }}>{t('delete')}</button>
          <button onClick={() => setConfirmingDelete(false)} className="text-xs cursor-pointer" style={{ color: '#6B7280' }}>{t('cancel')}</button>
        </div>
      )}
    </div>
  );
}

function CategoryEntries({ entries, locale, onChanged }: { entries: CategoryEntryLine[]; locale: string; onChanged: () => void }) {
  const t = useTranslations('cards.decision.entries');
  if (entries.length === 0) {
    return <p className="text-xs py-2 px-2 italic" style={{ color: '#9CA3AF' }}>{t('noEntries')}</p>;
  }
  return (
    <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
      {entries.map((entry) => (
        <EntryLine key={entry.id} entry={entry} locale={locale} onChanged={onChanged} />
      ))}
    </div>
  );
}

export default function CardDecisionView({
  totalGoal,
  totalSpent,
  envelopeItems,
  uncategorized,
  entriesByCategory,
  uncategorizedEntries,
  locale,
  onEditEnvelope,
  onEntryChanged,
}: DecisionViewProps) {
  const t = useTranslations('cards');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const remaining = totalGoal !== null ? totalGoal - totalSpent : null;
  const overGoal = remaining !== null && remaining < 0;
  // Regression fix: this used to gate on envelopeItems.length alone, which
  // hid the ENTIRE table — including the uncategorized row — whenever a
  // card had no saved envelope items yet but did have real, uncategorized
  // entries. Those entries were invisible even though they existed in the
  // DB. A category-less entry never lands in envelopeItems (it's not tied
  // to any category), so it must be checked separately here.
  const hasEnvelope = envelopeItems.length > 0 || uncategorized > 0;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // TOTAL row sums its own columns — Envelope and Spent are independent
  // truths, not a comparison against the card goal (that comparison lives in
  // its own labeled line below, tied to the same warn-not-block rule the
  // editor already uses).
  const envelopeSum = envelopeItems.reduce((s, i) => s + i.monthlyAmount, 0);
  const spentSum = envelopeItems.reduce((s, i) => s + i.actual, 0) + uncategorized;
  const leftSum = envelopeSum - spentSum;
  const totalStatus: EnvelopeStatus = envelopeStatus(envelopeSum, spentSum);
  const overAllocated = totalGoal !== null && sumWarning(envelopeItems.map((i) => ({ monthlyAmount: i.monthlyAmount })), totalGoal);

  const statusColor = (status: EnvelopeStatus, actual: number) => {
    if (status === 'over') return '#DC2626';
    if (status === 'watch') return '#D97706';
    if (status === 'ok' && actual > 0) return '#16A34A';
    return '#9CA3AF';
  };

  return (
    <div className="space-y-4">
      {/* Three-question header strip */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-2xl bg-white p-3 sm:p-5 min-w-0" style={{ border: '1px solid #E5E7EB' }}>
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wide mb-1 truncate" style={{ color: '#6B7280' }}>
            {t('decision.totalGoal')}
          </p>
          <p className="text-base sm:text-2xl font-bold truncate" style={{ color: '#0F2044' }}>
            {totalGoal !== null ? formatCurrency(totalGoal, locale) : <span style={{ color: '#9CA3AF' }}>{t('decision.noGoal')}</span>}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-3 sm:p-5 min-w-0" style={{ border: '1px solid #E5E7EB' }}>
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wide mb-1 truncate" style={{ color: '#6B7280' }}>
            {t('decision.spent')}
          </p>
          <p className="text-base sm:text-2xl font-bold truncate" style={{ color: overGoal ? '#DC2626' : '#0F2044' }}>
            {formatCurrency(totalSpent, locale)}
          </p>
        </div>

        <div className="rounded-2xl p-3 sm:p-5 min-w-0" style={{
          border: overGoal ? '2px solid #DC2626' : '1px solid #E5E7EB',
          background: overGoal ? '#FEF2F2' : 'white',
        }}>
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-wide mb-1 truncate" style={{ color: '#6B7280' }}>
            {t('decision.remaining')}
          </p>
          <p className="text-base sm:text-2xl font-bold truncate" style={{ color: remaining === null ? '#9CA3AF' : overGoal ? '#DC2626' : '#16A34A' }}>
            {remaining !== null ? formatCurrency(remaining, locale) : '—'}
          </p>
          {overGoal && (
            <p className="text-[10px] sm:text-xs font-semibold mt-1 truncate" style={{ color: '#DC2626' }}>
              {t('decision.overGoal')}
            </p>
          )}
        </div>
      </div>

      {/* Per-category decision table */}
      <div className="rounded-2xl bg-white p-3 sm:p-6" style={{ border: '1px solid #E5E7EB' }}>
        {!hasEnvelope ? (
          <div className="text-center py-6">
            <p className="text-sm mb-3" style={{ color: '#6B7280' }}>{t('decision.noEnvelope')}</p>
            <button
              onClick={onEditEnvelope}
              className="px-4 py-2 rounded-full text-sm font-medium cursor-pointer hover:opacity-90"
              style={{ background: '#0F2044', color: 'white' }}
            >
              {t('editor.title')}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold" style={{ color: '#0F2044' }}>
                {t('decision.category')}
              </h3>
              <button
                onClick={onEditEnvelope}
                className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-80"
                style={{ border: '1.5px solid #2ABFBF', color: '#2ABFBF' }}
              >
                {t('editor.title')}
              </button>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th className="text-left py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.category')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.subBudget')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.actual')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.difference')}</th>
                  <th className="text-right py-2 font-semibold" style={{ color: '#0F2044' }}>{t('decision.status')}</th>
                </tr>
              </thead>
              <tbody>
                {envelopeItems.map((row) => {
                  const isOpen = expanded.has(row.categoryId);
                  return (
                    <Fragment key={row.categoryId}>
                      <tr
                        onClick={() => toggle(row.categoryId)}
                        className="cursor-pointer hover:opacity-80"
                        style={{ borderBottom: isOpen ? 'none' : '1px solid #F3F4F6' }}
                      >
                        <td className="py-2.5 font-medium" style={{ color: '#0F2044' }}>
                          <span className="mr-1.5 text-xs" style={{ color: '#9CA3AF' }}>{isOpen ? '▾' : '▸'}</span>
                          {row.categoryName}
                        </td>
                        <td className="py-2.5 text-right" style={{ color: '#6B7280' }}>
                          {formatCurrency(row.monthlyAmount, locale)}
                        </td>
                        <td className="py-2.5 text-right font-medium" style={{ color: '#0F2044' }}>
                          {formatCurrency(row.actual, locale)}
                        </td>
                        <td className="py-2.5 text-right font-medium" style={{ color: statusColor(row.status, row.actual) }}>
                          {row.monthlyAmount > 0 ? formatCurrency(row.remaining, locale) : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          {row.status === 'over' ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                              {t('decision.over')}
                            </span>
                          ) : row.status === 'watch' ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
                              {t('decision.watch')}
                            </span>
                          ) : row.status === 'ok' && row.actual > 0 ? (
                            <span className="text-xs font-semibold" style={{ color: '#16A34A' }}>✓ {t('decision.ok')}</span>
                          ) : (
                            <span style={{ color: '#9CA3AF' }}>—</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td colSpan={5} className="pb-2.5" style={{ background: '#FAFAFA' }}>
                            <CategoryEntries
                              entries={entriesByCategory[row.categoryId] ?? []}
                              locale={locale}
                              onChanged={onEntryChanged}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* Uncategorized row (always shown when > 0) */}
                {uncategorized > 0 && (
                  <>
                    <tr
                      onClick={() => toggle(UNCATEGORIZED_ROW_ID)}
                      className="cursor-pointer hover:opacity-80"
                      style={{ borderBottom: expanded.has(UNCATEGORIZED_ROW_ID) ? 'none' : '1px solid #F3F4F6' }}
                    >
                      <td className="py-2.5 italic" style={{ color: '#9CA3AF' }}>
                        <span className="mr-1.5 text-xs">{expanded.has(UNCATEGORIZED_ROW_ID) ? '▾' : '▸'}</span>
                        {t('decision.uncategorized')}
                      </td>
                      <td className="py-2.5 text-right" style={{ color: '#9CA3AF' }}>—</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: '#DC2626' }}>
                        {formatCurrency(uncategorized, locale)}
                      </td>
                      <td className="py-2.5 text-right" style={{ color: '#9CA3AF' }}>—</td>
                      <td className="py-2.5 text-right">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
                          !
                        </span>
                      </td>
                    </tr>
                    {expanded.has(UNCATEGORIZED_ROW_ID) && (
                      <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td colSpan={5} className="pb-2.5" style={{ background: '#FAFAFA' }}>
                          <CategoryEntries entries={uncategorizedEntries} locale={locale} onChanged={onEntryChanged} />
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
              <tfoot>
                {/* TOTAL sums its own columns — no goal comparison mixed in. */}
                <tr style={{ borderTop: '2px solid #0F2044' }}>
                  <td className="py-3 font-bold" style={{ color: '#0F2044' }}>{t('decision.total')}</td>
                  <td className="py-3 text-right font-bold" style={{ color: '#0F2044' }}>
                    {formatCurrency(envelopeSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold" style={{ color: statusColor(totalStatus, spentSum) === '#9CA3AF' ? '#0F2044' : statusColor(totalStatus, spentSum) }}>
                    {formatCurrency(spentSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold" style={{ color: leftSum < 0 ? '#DC2626' : '#0F2044' }}>
                    {formatCurrency(leftSum, locale)}
                  </td>
                  <td className="py-3 text-right font-bold">
                    {totalStatus === 'over' ? (
                      <span style={{ color: '#DC2626' }}>{t('decision.over')}</span>
                    ) : totalStatus === 'watch' ? (
                      <span style={{ color: '#D97706' }}>{t('decision.watch')}</span>
                    ) : totalStatus === 'ok' ? (
                      <span style={{ color: '#16A34A' }}>✓ {t('decision.ok')}</span>
                    ) : (
                      <span style={{ color: '#9CA3AF' }}>—</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>

            {/* Goal comparison lives on its own line — a separate truth from the
                column sums above. Warn, never block, same rule the editor uses. */}
            {overAllocated && (
              <p className="text-xs font-medium mt-3 px-3 py-2 rounded-lg" style={{ background: '#FEF3C7', color: '#D97706' }}>
                {t('decision.goalVsAllocated', {
                  goal: formatCurrency(totalGoal as number, locale),
                  sum: formatCurrency(envelopeSum, locale),
                  over: formatCurrency(envelopeSum - (totalGoal as number), locale),
                })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
