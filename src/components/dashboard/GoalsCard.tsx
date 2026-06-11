import { useTranslations } from 'next-intl';
import { Goal, formatCurrency } from './types';

export default function GoalsCard({ goals, locale }: { goals: Goal[]; locale: string }) {
  const t = useTranslations('dashboard');
  if (!goals.length) return null;

  return (
    <div className="rounded-2xl bg-white p-8" style={{ border: '1px solid #E5E7EB' }}>
      <h2 className="text-xl font-bold mb-4" style={{ color: '#0F2044' }}>
        {t('goals')}
      </h2>
      <div className="space-y-5">
        {goals.map((goal, i) => {
          const pct = goal.target_amount > 0
            ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
            : 0;
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <p className="font-medium" style={{ color: '#0F2044' }}>{goal.name}</p>
                <p className="text-sm font-medium" style={{ color: '#6B7280' }}>
                  {formatCurrency(goal.current_amount, locale)} / {formatCurrency(goal.target_amount, locale)}
                </p>
              </div>
              <div className="w-full h-2.5 rounded-full" style={{ background: '#F3F4F6' }}>
                <div
                  className="h-2.5 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: '#2ABFBF' }}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: '#6B7280' }}>{pct}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}