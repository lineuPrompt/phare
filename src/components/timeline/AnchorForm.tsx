'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function AnchorForm({
  accountId,
  defaultDate,
  defaultBalance,
  onSaved,
  onCancel,
}: {
  accountId: string;
  defaultDate?: string;
  defaultBalance?: number;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('timeline.anchorForm');

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(defaultDate ?? today);
  const [balance, setBalance] = useState(defaultBalance !== undefined ? String(defaultBalance) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || balance === '' || !isFinite(Number(balance))) return;
    setSaving(true);
    setError(null);

    const res = await fetch('/api/anchors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, anchorDate: date, balance: Number(balance) }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? t('genericError'));
      return;
    }

    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>{t('date')}</label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>{t('balance')}</label>
          <input
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder={t('balancePlaceholder')}
            required
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ border: '1.5px solid #D1D5DB', outline: 'none', color: '#0F2044' }}
          />
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ border: '1.5px solid #D1D5DB', color: '#6B7280', background: 'white' }}
          >
            {t('cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={saving || balance === ''}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{ background: '#2ABFBF', color: 'white' }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </form>
  );
}
