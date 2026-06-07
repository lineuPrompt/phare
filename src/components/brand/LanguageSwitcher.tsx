'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';

export default function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.startsWith('/fr') ? 'fr' : 'en';

  const toggle = useCallback(() => {
    const next = locale === 'en' ? 'fr' : 'en';
    const newPath = pathname.replace(`/${locale}`, `/${next}`);
    router.push(newPath);
  }, [locale, pathname, router]);

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all cursor-pointer"
      style={{
        border: '1.5px solid #2ABFBF',
        color: '#2ABFBF',
      }}
    >
      {locale === 'en' ? '🇫🇷 Français' : '🇨🇦 English'}
    </button>
  );
}