import {useTranslations, useLocale} from 'next-intl';
import Link from 'next/link';
import Navbar from '@/components/brand/Navbar';

export default function Home() {
  const t = useTranslations('landing');
  const tLegal = useTranslations('legal');
  const locale = useLocale();

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
          <div
            className="px-8 py-3 rounded-full text-white font-semibold text-lg inline-block"
            style={{background: '#9CA3AF'}}
          >
            {t('hero.cta')}
          </div>
          <a href="#how-it-works"
            className="px-8 py-3 rounded-full font-semibold text-lg transition-all hover:opacity-90 cursor-pointer inline-block"
            style={{ border: '2px solid #0F2044', color: '#0F2044' }}
          >
            {t('hero.secondaryCta')}
          </a>
        </div>
        <p className="mt-2 text-xs" style={{color: '#9CA3AF'}}>{t('hero.ctaNote')}</p>

        <p className="mt-6 text-sm" style={{color: '#6B7280'}}>
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
      <section id="how-it-works" className="px-6 py-20" style={{background: '#FAFAF8'}}>
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

      {/* Pricing — two tiers. Pro has no working checkout yet (that's a
          later build with Stripe), so it carries a "Coming soon" badge and
          no CTA. Free's CTA is inert too — signup isn't open yet. */}
      <section className="px-6 py-20" style={{background: '#FAFAF8'}}>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{color: '#0F2044'}}>
            {t('pricing.title')}
          </h2>
          <p className="text-lg mb-10" style={{color: '#6B7280'}}>
            {t('pricing.subtitle')}
          </p>

          <div className="grid md:grid-cols-2 gap-6 text-left">
            {/* Free tier */}
            <div className="bg-white rounded-2xl p-8" style={{border: '2px solid #E5E7EB'}}>
              <p className="text-sm font-semibold mb-1" style={{color: '#6B7280'}}>
                {t('pricing.free.name')} — {t('pricing.free.tier')}
              </p>
              <div className="mb-6">
                <span className="text-4xl font-bold" style={{color: '#0F2044'}}>{t('pricing.free.price')}</span>
              </div>

              <div className="space-y-3 mb-8">
                {(['onboarding', 'spending', 'family', 'goals', 'sinking', 'bilingual', 'horizon', 'reviewPreview'] as const).map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <span style={{color: '#2ABFBF'}}>✓</span>
                    <span style={{color: '#374151'}}>{t(`pricing.free.features.${key}`)}</span>
                  </div>
                ))}
              </div>

              <div
                className="block w-full py-3 rounded-full font-semibold text-lg text-center"
                style={{background: '#F3F4F6', color: '#9CA3AF'}}
              >
                {t('pricing.free.cta')}
              </div>
              <p className="text-xs text-center mt-2" style={{color: '#9CA3AF'}}>{t('pricing.free.ctaNote')}</p>
            </div>

            {/* Pro tier */}
            <div className="bg-white rounded-2xl p-8 relative" style={{border: '2px solid #2ABFBF'}}>
              <span
                className="absolute top-6 right-6 px-3 py-1 rounded-full text-xs font-medium"
                style={{background: '#FEF3C7', color: '#92400E'}}
              >
                {t('pricing.pro.badge')}
              </span>

              <p className="text-sm font-semibold mb-1" style={{color: '#2ABFBF'}}>{t('pricing.pro.name')}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-bold" style={{color: '#0F2044'}}>{t('pricing.pro.price')}</span>
                <span className="text-lg" style={{color: '#6B7280'}}>{t('pricing.pro.period')}</span>
              </div>
              <p className="text-sm mb-3" style={{color: '#6B7280'}}>{t('pricing.pro.annual')}</p>
              <p className="text-sm mb-6" style={{color: '#6B7280'}}>{t('pricing.pro.perHousehold')}</p>

              <div className="space-y-3 mb-8">
                {(['review', 'regeneration', 'horizon', 'audit', 'newPlan', 'categories'] as const).map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <span style={{color: '#2ABFBF'}}>✓</span>
                    <span style={{color: '#374151'}}>{t(`pricing.pro.features.${key}`)}</span>
                  </div>
                ))}
              </div>

              {/* Signed-out visitors get SIGNUP, not checkout. A Checkout
                  Session attaches the subscription to a household, so there is
                  nothing to buy until one exists. Signed-in households upgrade
                  in-app instead — from any padlock, or the Household page —
                  which is also where the monthly/annual choice lives. */}
              <Link
                href={`/${locale}/signin`}
                className="block w-full py-3 rounded-full font-semibold text-lg text-center text-white cursor-pointer hover:opacity-90 transition-all"
                style={{background: '#2ABFBF'}}
              >
                {t('pricing.pro.cta')}
              </Link>
              <p className="text-xs text-center mt-2" style={{color: '#9CA3AF'}}>{t('pricing.pro.ctaNote')}</p>
            </div>
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
          <div
            className="px-10 py-4 rounded-full font-semibold text-lg inline-block"
            style={{background: 'rgba(255,255,255,0.1)', color: '#94A3B8'}}
          >
            {t('finalCta.cta')}
          </div>
          <p className="text-sm mt-3" style={{color: '#64748B'}}>{t('finalCta.ctaNote')}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8" style={{background: '#0A1628', borderTop: '1px solid rgba(255,255,255,0.1)'}}>
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm" style={{color: '#94A3B8'}}>{t('footer.builtFor')}</p>
          <p className="text-sm" style={{color: '#94A3B8'}}>
            {t('footer.contact')}{' '}
            <a href="mailto:support@phare.money" className="underline" style={{color: '#94A3B8'}}>
              support@phare.money
            </a>
          </p>
          <p className="text-sm" style={{color: '#94A3B8'}}>{t('footer.copyright')}</p>
        </div>

        {/* Legal links. Public pages, deliberately reachable without an account
            — the consent checkbox links here, so gating them would deadlock
            anyone who has not yet accepted. */}
        <div className="max-w-4xl mx-auto mt-6 pt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
             style={{borderTop: '1px solid rgba(255,255,255,0.1)'}}>
          <Link href={`/${locale}/privacy`} className="text-sm underline" style={{color: '#94A3B8'}}>
            {tLegal('footerPrivacy')}
          </Link>
          <Link href={`/${locale}/terms`} className="text-sm underline" style={{color: '#94A3B8'}}>
            {tLegal('footerTerms')}
          </Link>
          <Link href={`/${locale}/faq`} className="text-sm underline" style={{color: '#94A3B8'}}>
            {tLegal('footerFaq')}
          </Link>
        </div>
      </footer>
    </main>
  );
}