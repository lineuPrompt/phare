import {useTranslations} from 'next-intl';
import Navbar from '@/components/brand/Navbar';

export default function Home() {
  const t = useTranslations('landing');

  return (
    <main className="min-h-screen" style={{background: '#FAFAF8'}}>
      <Navbar />

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20">
        <div
          className="mb-6 px-4 py-1.5 rounded-full text-sm font-medium"
          style={{ background: '#E6F7F7', color: '#1A9A9A' }}
        >
          {t('badge')}
        </div>

        <h1
          className="text-4xl md:text-6xl font-bold max-w-3xl leading-tight mb-6"
          style={{color: '#0F2044'}}
        >
          {t('hero.title')}
        </h1>

        <p className="text-lg md:text-xl max-w-xl mb-10" style={{color: '#6B7280'}}>
          {t('hero.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            className="px-8 py-3 rounded-full text-white font-semibold text-lg transition-all hover:opacity-90 cursor-pointer"
            style={{background: '#0F2044'}}
          >
            {t('hero.cta')}
          </button>
          <button
            className="px-8 py-3 rounded-full font-semibold text-lg transition-all hover:opacity-90 cursor-pointer"
            style={{ border: '2px solid #0F2044', color: '#0F2044' }}
          >
            {t('hero.secondaryCta')}
          </button>
        </div>

        <p className="mt-8 text-sm" style={{color: '#6B7280'}}>
          {t('hero.socialProof')}
        </p>
      </section>

      {/* Problem */}
      <section className="px-6 py-20" style={{background: '#0F2044'}}>
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
            {t('problem.title')}
          </h2>
          <p className="text-lg" style={{color: '#94A3B8'}}>
            {t('problem.subtitle')}
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['taxes', 'registration', 'school', 'income_tax'] as const).map((key) => (
            <div
              key={key}
              className="rounded-2xl p-6"
              style={{background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)'}}
            >
              <h3 className="text-lg font-semibold mb-2 text-white">
                {t(`problem.items.${key}.title`)}
              </h3>
              <p style={{color: '#94A3B8'}}>
                {t(`problem.items.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20" style={{background: '#FAFAF8'}}>
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{color: '#0F2044'}}>
            {t('howItWorks.title')}
          </h2>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {(['upload', 'plan', 'review'] as const).map((key) => (
            <div key={key} className="text-center">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4 text-white"
                style={{background: '#2ABFBF'}}
              >
                {t(`howItWorks.steps.${key}.number`)}
              </div>
              <h3 className="text-xl font-semibold mb-3" style={{color: '#0F2044'}}>
                {t(`howItWorks.steps.${key}.title`)}
              </h3>
              <p style={{color: '#6B7280'}}>
                {t(`howItWorks.steps.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20" style={{background: '#F0FDFD'}}>
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold" style={{color: '#0F2044'}}>
            {t('features.title')}
          </h2>
        </div>

        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          {(['familyBudgets', 'sinkingFunds', 'goalTracking', 'monthlyReview'] as const).map((key) => (
            <div
              key={key}
              className="bg-white rounded-2xl p-8"
              style={{border: '1px solid #E5E7EB'}}
            >
              <h3 className="text-xl font-semibold mb-3" style={{color: '#0F2044'}}>
                {t(`features.${key}.title`)}
              </h3>
              <p style={{color: '#6B7280'}}>
                {t(`features.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-20" style={{background: '#FAFAF8'}}>
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{color: '#0F2044'}}>
            {t('pricing.title')}
          </h2>
          <p className="text-lg mb-10" style={{color: '#6B7280'}}>
            {t('pricing.subtitle')}
          </p>

          <div
            className="bg-white rounded-2xl p-10"
            style={{border: '2px solid #2ABFBF'}}
          >
            <div className="flex items-baseline justify-center gap-1 mb-2">
              <span className="text-5xl font-bold" style={{color: '#0F2044'}}>{t('pricing.price')}</span>
              <span className="text-xl" style={{color: '#6B7280'}}>{t('pricing.period')}</span>
            </div>

            <p className="text-sm mb-1" style={{color: '#2ABFBF'}}>{t('pricing.annual')}</p>
            <p className="text-sm mb-8" style={{color: '#6B7280'}}>{t('pricing.perHousehold')}</p>

            <div className="text-left mb-8 space-y-3">
              {(['upload', 'budgets', 'sinking', 'goals', 'review', 'alerts', 'bilingual', 'canadian'] as const).map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <span style={{color: '#2ABFBF'}}>✓</span>
                  <span style={{color: '#374151'}}>{t(`pricing.features.${key}`)}</span>
                </div>
              ))}
            </div>

            <button
              className="w-full py-3 rounded-full text-white font-semibold text-lg transition-all hover:opacity-90 cursor-pointer"
              style={{background: '#0F2044'}}
            >
              {t('pricing.cta')}
            </button>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 py-20" style={{background: '#0F2044'}}>
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-white">
            {t('finalCta.title')}
          </h2>
          <p className="text-lg mb-10" style={{color: '#94A3B8'}}>
            {t('finalCta.subtitle')}
          </p>
          <button
            className="px-10 py-4 rounded-full font-semibold text-lg transition-all hover:opacity-90 cursor-pointer"
            style={{background: '#2ABFBF', color: '#0F2044'}}
          >
            {t('finalCta.cta')}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8" style={{background: '#0A1628', borderTop: '1px solid rgba(255,255,255,0.1)'}}>
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm" style={{color: '#94A3B8'}}>{t('footer.builtFor')}</p>
          <p className="text-sm" style={{color: '#94A3B8'}}>{t('footer.copyright')}</p>
        </div>
      </footer>
    </main>
  );
}