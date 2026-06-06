'use client';

import {useRouter, usePathname} from 'next/navigation';

export default function LanguageSwitcher() {
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const toggleLocale = () => {
    const nextLocale = locale === 'en' ? 'fr' : 'en';
    const newPath = pathname.replace(`/${locale}`, `/${nextLocale}`);
    router.push(newPath);
  };

  const router = useRouter();

  return (
    <button
      onClick={toggleLocale}
      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium transition-all"
      style={{
        border: '1.5px solid #2ABFBF',
        color: '#2ABFBF',
      }}
    >
      {locale === 'en' ? '🇫🇷 Français' : '🇨🇦 English'}
    </button>
  );
}