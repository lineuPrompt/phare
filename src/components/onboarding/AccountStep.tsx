'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function AccountStep({
  cardCount,
  setCardCount,
  cardNames,
  setCardNames,
  openingBalance,
  setOpeningBalance,
  onConfirm,
  creating,
}: {
  cardCount: number;
  setCardCount: (n: number) => void;
  cardNames: string[];
  setCardNames: (names: string[]) => void;
  openingBalance: string;
  setOpeningBalance: (v: string) => void;
  onConfirm: () => void;
  creating: boolean;
}) {
  const t = useTranslations('upload.accounts');

  useEffect(() => {
    const next = [...cardNames];
    while (next.length < cardCount) next.push(`Card ${next.length + 1}`);
    setCardNames(next.slice(0, cardCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardCount]);

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h3 className="text-xl font-bold mb-2" style={{ color: '#0F2044' }}>{t('title')}</h3>
      <p className="text-sm mb-6" style={{ color: '#6B7280' }}>{t('subtitle')}</p>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2" style={{ color: '#0F2044' }}>{t('howMany')}</label>
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setCardCount(n)}
              className="w-12 h-12 rounded-xl text-sm font-bold cursor-pointer transition-all"
              style={{
                border: cardCount === n ? '2px solid #2ABFBF' : '1.5px solid #D1D5DB',
                background: cardCount === n ? '#F0FDFD' : 'white',
                color: cardCount === n ? '#0F2044' : '#6B7280',
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {cardCount > 0 && (
        <div className="space-y-3 mb-6">
          <label className="block text-sm font-medium" style={{ color: '#0F2044' }}>{t('nameThem')}</label>
          {Array.from({ length: cardCount }).map((_, i) => (
            <input
              key={i}
              type="text"
              value={cardNames[i] ?? ''}
              onChange={(e) => {
                const next = [...cardNames];
                next[i] = e.target.value;
                setCardNames(next);
              }}
              placeholder={`${t('cardPlaceholder')} ${i + 1}`}
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          ))}
        </div>
      )}

      {/* THE OPENING BALANCE. Onboarding never asked for one, so every
          household arrived at the dashboard with no account_balance_anchors
          row — which silently removed the projection tile (PlanChainTile
          returns null with no planMonth) and left Timeline empty. This is the
          one real number the whole forward-looking half of the product is
          built on, and it is asked here because this is already the "your
          accounts" step.

          Deliberately ONE field, not the date+balance pair Timeline's
          AnchorForm uses: today's date is the only one worth defaulting to
          during onboarding, and a second field is exactly the weight we are
          trying to remove. A different date can be set later on Timeline.

          Optional, and the hint says so. Skipping it is a legitimate choice —
          the dashboard's anchor prompt (AnchorPromptCard) picks up anyone who
          does, so the number is never silently missing. */}
      <div className="mb-6 pt-5" style={{ borderTop: '1px dashed #E5E7EB' }}>
        <label className="block text-sm font-medium mb-2" style={{ color: '#0F2044' }}>
          {t('openingBalance')}
        </label>
        <input
          type="number"
          step="0.01"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          placeholder={t('openingBalancePlaceholder')}
          className="w-48 px-4 py-2.5 rounded-lg text-sm outline-none"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        />
        <p className="text-xs mt-1.5" style={{ color: '#9CA3AF' }}>{t('openingBalanceHint')}</p>
      </div>

      <button
        onClick={onConfirm}
        disabled={creating}
        className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
        style={{ background: '#0F2044' }}
      >
        {creating ? t('creating') : t('continue')}
      </button>
    </div>
  );
}