import { useTranslations } from 'next-intl';

export default function TopPriorityCard({ text }: { text: string }) {
  const t = useTranslations('dashboard');
  return (
    <div className="rounded-2xl p-6" style={{ background: '#0F2044' }}>
      <p className="text-sm font-medium mb-2" style={{ color: '#2ABFBF' }}>
        {t('topPriority')}
      </p>
      <p className="text-lg font-semibold text-white">{text}</p>
    </div>
  );
}