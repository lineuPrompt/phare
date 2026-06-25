'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import Navbar from '@/components/brand/Navbar';

export default function SetPasswordPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
  const next = searchParams.get('next') ?? `/${locale}/dashboard`;

  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [checking, setChecking]   = useState(true);

  // If there's no active session (user navigated here directly), send to sign-in.
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace(`/${locale}/signin`);
      else setChecking(false);
    });
  }, [router, locale]);

  const handleSubmit = async () => {
    if (password.length < 8) {
      setError(locale === 'fr'
        ? 'Le mot de passe doit contenir au moins 8 caractères.'
        : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError(locale === 'fr'
        ? 'Les mots de passe ne correspondent pas.'
        : 'Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');

    const { error: updateError } = await createClient().auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.replace(next);
  };

  if (checking) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />
      <div className="max-w-md mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2 text-center" style={{ color: '#0F2044' }}>
          {locale === 'fr' ? 'Définir votre mot de passe' : 'Set your password'}
        </h1>
        <p className="text-center mb-10 text-sm" style={{ color: '#6B7280' }}>
          {locale === 'fr'
            ? 'Choisissez un mot de passe pour accéder à Phare.'
            : 'Choose a password to access Phare.'}
        </p>

        <div className="rounded-2xl bg-white p-8 space-y-4" style={{ border: '1px solid #E5E7EB' }}>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
              {locale === 'fr' ? 'Nouveau mot de passe' : 'New password'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#0F2044' }}>
              {locale === 'fr' ? 'Confirmer le mot de passe' : 'Confirm password'}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && confirm && !loading) handleSubmit();
              }}
              className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
            />
          </div>
          {error && <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>}
          <button
            onClick={handleSubmit}
            disabled={loading || !password || !confirm}
            className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
            style={{ background: '#0F2044' }}
          >
            {loading
              ? (locale === 'fr' ? 'Enregistrement...' : 'Saving...')
              : (locale === 'fr' ? 'Définir le mot de passe' : 'Set password')}
          </button>
        </div>
      </div>
    </main>
  );
}
