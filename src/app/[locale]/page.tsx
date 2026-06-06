import {useTranslations} from 'next-intl';
import Navbar from '@/components/brand/Navbar';

export default function Home() {
  const t = useTranslations('landing.hero');

  return (
    <main className="min-h-screen" style={{background: '#FAFAF8'}}>
      <Navbar />
      
      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-16">
        
        {/* Badge */}
        <div
          className="mb-6 px-4 py-1.5 rounded-full text-sm font-medium"
          style={{
            background: '#E6F7F7',
            color: '#2ABFBF',
          }}
        >
          AI financial coach for Canadian families
        </div>

        {/* Headline */}
        <h1
          className="text-4xl md:text-6xl font-bold max-w-3xl leading-tight mb-6"
          style={{color: '#0F2044'}}
        >
          {t('title')}
        </h1>

        {/* Subtitle */}
        <p
          className="text-lg md:text-xl max-w-xl mb-10"
          style={{color: '#6B7280'}}
        >
          {t('subtitle')}
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            className="px-8 py-3 rounded-full text-white font-semibold text-lg transition-all hover:opacity-90"
            style={{background: '#0F2044'}}
          >
            {t('cta')}
          </button>
          <button
            className="px-8 py-3 rounded-full font-semibold text-lg transition-all hover:opacity-90"
            style={{
              border: '2px solid #0F2044',
              color: '#0F2044',
            }}
          >
            {t('secondaryCta')}
          </button>
        </div>

        {/* Social proof */}
        <p className="mt-8 text-sm" style={{color: '#6B7280'}}>
          Built for Canadian families · RRSP, RESP, TFSA aware · English & Français
        </p>

      </section>
    </main>
  );
}