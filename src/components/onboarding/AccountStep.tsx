'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function AccountStep({
  cardCount,
  setCardCount,
  cardNames,
  setCardNames,
  onConfirm,
  creating,
}: {
  cardCount: number;
  setCardCount: (n: number) => void;
  cardNames: string[];
  setCardNames: (names: string[]) => void;
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