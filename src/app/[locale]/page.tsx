import {useTranslations} from 'next-intl';

export default function Home() {
  const t = useTranslations('landing.hero');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>
      <button>{t('cta')}</button>
    </main>
  );
}