'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import Navbar from '@/components/brand/Navbar';

export default function SignInPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setInfo('');
    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, locale },
          },
        });
        if (error) throw error;
        setInfo(t('checkEmail'));
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(`/${locale}/dashboard`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2 text-center" style={{ color: '#0F2044' }}>
          {mode === 'signin' ? t('signinTitle') : t('signupTitle')}
        </h1>
        <p className="text-center mb-10" style={{ color: '#6B7280' }}>
          {mode === 'signin' ? t('signinSubtitle') : t('signupSubtitle')}
        </p>

        <div className="rounded-2xl bg-white p-8 space-y-4" style={{ border: '1px solid #E5E7EB' }}>
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
                {t('fullName')}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
              {t('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
              {t('password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email && password && !loading) handleSubmit();
              }}
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm" style={{ color: '#16A34A' }}>{info}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading || !email || !password || (mode === 'signup' && !fullName)}
            className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
            style={{ background: '#0F2044' }}
          >
            {loading ? t('loading') : mode === 'signin' ? t('signinBtn') : t('signupBtn')}
          </button>

          <p className="text-sm text-center" style={{ color: '#6B7280' }}>
            {mode === 'signin' ? t('noAccount') : t('hasAccount')}{' '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }}
              className="font-medium underline cursor-pointer"
              style={{ color: '#2ABFBF' }}
            >
              {mode === 'signin' ? t('signupLink') : t('signinLink')}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}