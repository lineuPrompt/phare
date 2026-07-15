'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function Sidebar({ locale, role: roleProp }: { locale: string; role?: string }) {
  const t = useTranslations('dashboard.nav');
  const pathname = usePathname();

  // When the parent knows the role (e.g. the household page), use it directly.
  // Otherwise fetch it once — this ensures the household link appears across all pages for owners.
  const [role, setRole] = useState<string | null>(roleProp ?? null);

  useEffect(() => {
    if (roleProp !== undefined) return; // already provided
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.role) setRole(d.role); })
      .catch(() => {});
  }, [roleProp]);

  const items = [
    { href: `/${locale}/dashboard`, label: t('overview'),  icon: '🏠' },
    { href: `/${locale}/expenses`,  label: t('expenses'),  icon: '🧾' },
    { href: `/${locale}/cards`,     label: t('cards'),     icon: '💳' },
    { href: `/${locale}/goals`,     label: t('goals'),     icon: '🎯' },
    { href: `/${locale}/planner`,   label: t('planner'),   icon: '📊' },
    { href: `/${locale}/upload`,    label: t('upload'),    icon: '📄' },
    { href: `/${locale}/recurring`, label: t('recurring'), icon: '🔁' },
    { href: `/${locale}/reconcile`, label: t('reconcile'), icon: '🔍' },
    ...(role === 'owner'
      ? [{ href: `/${locale}/household`, label: t('household'), icon: '👨‍👩‍👧' }]
      : []),
  ];

  const comingSoon = [
    { label: t('reviews'), icon: '✉️' },
  ];

  return (
    <aside
      className="hidden md:flex flex-col w-60 shrink-0 min-h-screen px-4 py-6"
      style={{ background: 'white', borderRight: '1px solid #E5E7EB' }}
    >
      <nav className="space-y-1 flex-1">
        {items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: isActive ? '#F0FDFD' : 'transparent',
                color: isActive ? '#0F2044' : '#6B7280',
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {comingSoon.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium opacity-40 cursor-not-allowed"
            style={{ color: '#6B7280' }}
          >
            <span>{item.icon}</span>
            {item.label}
            <span className="ml-auto text-xs">🔒</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}
