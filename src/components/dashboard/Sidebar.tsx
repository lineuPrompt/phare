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
  // Mobile drawer — the desktop <aside> below is `hidden` under the `md`
  // breakpoint with no fallback, which was a full navigation dead-end on a
  // phone (confirmed live: a real trial user on mobile could not reach any
  // page but the one they landed on). This state drives a hamburger toggle
  // + slide-in drawer, shown only below `md`, exposing the exact same items.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (roleProp !== undefined) return; // already provided
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.role) setRole(d.role); })
      .catch(() => {});
  }, [roleProp]);

  // Close the drawer whenever the route actually changes (covers back/forward
  // navigation too, not just a tap inside the drawer).
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Keyboard accessible: Escape closes, same as any other overlay in this app.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // IA consolidation: Timeline owns chequing, Cards owns cards, Expenses and
  // Planner are retired. Order follows the decision surfaces top to bottom;
  // Upload ("New plan") isn't part of that flow but has no other home and
  // touching the AI/plan flow was out of scope, so it's kept, placed after
  // Household rather than removed.
  const items = [
    { href: `/${locale}/dashboard`, label: t('overview'),  icon: '🏠' },
    { href: `/${locale}/timeline`,  label: t('timeline'),  icon: '📈' },
    { href: `/${locale}/cards`,     label: t('cards'),     icon: '💳' },
    { href: `/${locale}/goals`,     label: t('goals'),     icon: '🎯' },
    { href: `/${locale}/sinking-funds`, label: t('sinkingFunds'), icon: '🏦' },
    { href: `/${locale}/recurring`, label: t('recurring'), icon: '🔁' },
    { href: `/${locale}/reconcile`, label: t('reconcile'), icon: '🔍' },
    ...(role === 'owner'
      ? [{ href: `/${locale}/household`, label: t('household'), icon: '👨‍👩‍👧' }]
      : []),
    { href: `/${locale}/upload`,    label: t('upload'),    icon: '📄' },
  ];

  const comingSoon = [
    { label: t('reviews'), icon: '✉️' },
  ];

  // Shared between the mobile drawer and the desktop sidebar — one nav list,
  // rendered twice, so the item set can never drift between the two.
  const navList = (onNavigate?: () => void) => (
    <nav className="space-y-1 flex-1">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
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
  );

  return (
    <>
      {/* Mobile top bar — hamburger toggle, hidden at md and up (the real
          sidebar takes over there). This is the ONLY way to reach navigation
          on a phone, so it must always render, never be conditionally hidden
          by anything else on the page. */}
      <div
        className="md:hidden flex items-center px-4 py-3"
        style={{ background: 'white', borderBottom: '1px solid #E5E7EB' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t('openMenu')}
          aria-expanded={mobileOpen}
          aria-haspopup="true"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer"
          style={{ border: '1.5px solid #D1D5DB', color: '#0F2044' }}
        >
          <span aria-hidden="true">☰</span> {t('menu')}
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={t('menu')}>
          <div
            className="w-72 max-w-[85vw] h-full flex flex-col px-4 py-6 overflow-y-auto"
            style={{ background: 'white' }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold" style={{ color: '#0F2044' }}>{t('menu')}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={t('closeMenu')}
                className="text-xl leading-none cursor-pointer px-1"
                style={{ color: '#6B7280' }}
              >
                ✕
              </button>
            </div>
            {navList(() => setMobileOpen(false))}
          </div>
          <button
            type="button"
            className="flex-1 cursor-pointer"
            style={{ background: 'rgba(15,32,68,0.4)' }}
            onClick={() => setMobileOpen(false)}
            aria-label={t('closeMenu')}
          />
        </div>
      )}

      {/* Desktop sidebar — unchanged behavior, md and up only. */}
      <aside
        className="hidden md:flex flex-col w-60 shrink-0 min-h-screen px-4 py-6"
        style={{ background: 'white', borderRight: '1px solid #E5E7EB' }}
      >
        {navList()}
      </aside>
    </>
  );
}
