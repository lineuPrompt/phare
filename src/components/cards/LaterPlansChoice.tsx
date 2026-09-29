'use client';

import { useTranslations } from 'next-intl';

export type LaterPlansDecision = 'apply' | 'keep';

function monthName(yyyyMM: string, locale: string): string {
  return new Date(`${yyyyMM}-01T00:00:00`).toLocaleDateString(
    locale === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' }
  );
}

/**
 * Shown in the plan editor when later open/future months have a plan of their
 * own, which outranks the month being edited. The household must pick one:
 * nothing is pre-selected, and the editor will not save until they do. The
 * count and the months themselves are shown before they choose.
 */
export default function LaterPlansChoice({
  months,
  choice,
  onChoose,
  locale,
}: {
  months: string[];
  choice: LaterPlansDecision | null;
  onChoose: (c: LaterPlansDecision) => void;
  locale: string;
}) {
  const t = useTranslations('cards.editor');
  const count = months.length;
  const list = months.map((m) => monthName(m, locale)).join(', ');

  const option = (value: LaterPlansDecision, label: string) => {
    const selected = choice === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onChoose(value)}
        className="text-left px-3 py-2 rounded-lg text-sm cursor-pointer"
        style={{
          border: `1.5px solid ${selected ? '#0F2044' : '#D1D5DB'}`,
          background: selected ? '#EEF2F7' : 'white',
          color: '#0F2044',
          fontWeight: selected ? 600 : 400,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: '#FFFBEB', border: '1.5px solid #FCD34D' }}>
      <p className="text-sm font-semibold" style={{ color: '#0F2044' }}>{t('laterPlansTitle', { count })}</p>
      <p className="text-sm" style={{ color: '#374151' }}>{t('laterPlansBody', { count, months: list })}</p>
      <div role="radiogroup" aria-label={t('laterPlansTitle', { count })} className="flex flex-col gap-2">
        {option('apply', t('laterPlansApply', { count }))}
        {option('keep', t('laterPlansKeep', { count }))}
      </div>
    </div>
  );
}
