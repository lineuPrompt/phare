'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export default function AuthButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push(`/${locale}`);
    router.refresh();
  };

  if (loading) return <div className="w-20" />;

  if (user) {
    const name = user.user_metadata?.full_name || user.email;
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all hover:opacity-80"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: '#2ABFBF' }}
          >
            {String(name).charAt(0).toUpperCase()}
          </span>
          <span className="hidden sm:inline max-w-[140px] truncate">{name}</span>
          <span className="text-xs" style={{ color: '#6B7280' }}>▾</span>
        </button>

        {open && (
          <div
            className="absolute right-0 mt-2 w-48 rounded-xl bg-white py-2 z-50"
            style={{ border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(15,32,68,0.08)' }}
          >
            <div className="px-4 py-2 text-xs truncate" style={{ color: '#6B7280', borderBottom: '1px solid #F3F4F6' }}>
              {user.email}
            </div>
            <Link
              href={`/${locale}/dashboard`}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-gray-50 transition-all"
              style={{ color: '#0F2044' }}
            >
              {t('dashboard')}
            </Link>
            <button
              onClick={signOut}
              className="w-full text-left px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-gray-50 transition-all"
              style={{ color: '#DC2626' }}
            >
              {t('signOut')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={`/${locale}/signin`}
      className="px-4 py-1.5 rounded-full text-sm font-semibold cursor-pointer transition-all hover:opacity-90"
      style={{ background: '#0F2044', color: 'white' }}
    >
      {t('signinBtn')}
    </Link>
  );
}