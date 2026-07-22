import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SinkingFund, SinkingFundBuffer, formatCurrency, monthName } from './types';

// Summary only (Build 4 Part A lifecycle, 2026-07-21) — mirrors GoalsCard:
// the dashboard shows what's going on, all create/edit/delete actions live
// on the dedicated /sinking-funds management page.
export default function SinkingFundsCard({
  funds,
  buffer,
  locale,
}: {
  funds: SinkingFund[];
  buffer: SinkingFundBuffer;
  locale: string;
}) {
  const t = useTranslations('dashboard');
  const tSF = useTranslations('sinkingFundsPage');

  if (!funds.length) return null;

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold" style={{ color: '#0F2044' }}>
          {t('sinkingFunds')}
        </h2>
        <Link
          href={`/${locale}/sinking-funds`}
          className="text-sm font-medium"
          style={{ color: '#2ABFBF' }}
        >
          {tSF('manage')}
        </Link>
      </div>

      {buffer.linkedAccountId && (
        <p className="text-sm font-semibold mb-4" style={{ color: buffer.fundedAlready ? '#16A34A' : '#6B7280' }}>
          {tSF('currentBalance')}: {formatCurrency(buffer.balance, locale)}
        </p>
      )}

      <div className="space-y-3">
        {funds.map((fund) => (
          <div key={fund.id} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
            <div>
              <p className="font-medium" style={{ color: '#0F2044' }}>{fund.name}</p>
              <p className="text-sm" style={{ color: '#6B7280' }}>
                {monthName(fund.due_month, locale)}{fund.due_month ? ' · ' : ''}{formatCurrency(fund.annual_amount, locale)}{t('perYear')}
              </p>
            </div>
            <p className="font-bold" style={{ color: '#2ABFBF' }}>
              {formatCurrency(fund.monthly_provision, locale)}{t('perMonth')}
            </p>
          </div>
        ))}
      </div>

      {!buffer.linkedAccountId && (
        <Link
          href={`/${locale}/sinking-funds`}
          className="mt-4 inline-block text-sm font-semibold px-4 py-2 rounded-xl"
          style={{ background: '#F0FDFD', color: '#2ABFBF' }}
        >
          {tSF('startFunding', { amount: formatCurrency(buffer.totalMonthlyProvision, locale) })}
        </Link>
      )}
    </div>
  );
}
