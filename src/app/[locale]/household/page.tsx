'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';

type Member = {
  id: string;
  name: string;
  user_id: string | null;
  users?: { email: string; role: string } | null;
};

export default function HouseholdPage() {
  const t = useTranslations('household');
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'member' | 'owner'>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [setPasswordLink, setSetPasswordLink] = useState('');
  const [addedEmail, setAddedEmail] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/me').then((r) => r.json()),
      fetch('/api/household/members').then((r) => r.json()),
    ]).then(([me, membersData]) => {
      if (me.error) { router.push(`/${locale}/signin`); return; }
      setMyUserId(me.id);
      setMyRole(me.role);
      setMembers(membersData.members ?? []);
    }).catch(() => {
      router.push(`/${locale}/signin`);
    }).finally(() => setLoading(false));
  }, [router, locale]);

  const handleAdd = async () => {
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/household/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to add member'); return; }

      setAddedEmail(email.trim());
      setSetPasswordLink(data.setPasswordLink);
      setEmail('');
      setFullName('');
      setRole('member');

      // Refresh member list
      fetch('/api/household/members')
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(setPasswordLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <p style={{ color: '#6B7280' }}>{t('loading')}</p>
        </div>
      </main>
    );
  }

  if (myRole !== 'owner') {
    return (
      <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
        <Navbar />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <p style={{ color: '#6B7280' }}>{t('notOwner')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="flex">
        <Sidebar locale={locale} role="owner" />

        <div className="flex-1 min-w-0">
          <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
            <div>
              <h1 className="text-3xl font-bold" style={{ color: '#0F2044' }}>{t('title')}</h1>
              <p className="mt-1 text-sm" style={{ color: '#6B7280' }}>{t('subtitle')}</p>
            </div>

            {/* Current members */}
            <section className="rounded-2xl bg-white p-6 space-y-3" style={{ border: '1px solid #E5E7EB' }}>
              <h2 className="font-semibold text-sm uppercase tracking-wide" style={{ color: '#6B7280' }}>
                {t('membersTitle')}
              </h2>

              {members.length === 0 ? (
                <p className="text-sm" style={{ color: '#9CA3AF' }}>{t('noMembers')}</p>
              ) : (
                <ul className="divide-y" style={{ borderColor: '#F3F4F6' }}>
                  {members.map((m) => {
                    const isMe = m.user_id === myUserId;
                    const memberRole = m.users?.role ?? 'member';
                    return (
                      <li key={m.id} className="py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: '#0F2044' }}>
                            {m.name}
                            {isMe && (
                              <span className="ml-2 text-xs" style={{ color: '#9CA3AF' }}>
                                ({t('you')})
                              </span>
                            )}
                          </p>
                          {m.users?.email && (
                            <p className="text-xs" style={{ color: '#6B7280' }}>{m.users.email}</p>
                          )}
                        </div>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            background: memberRole === 'owner' ? '#EEF2FF' : '#F0FDFD',
                            color:      memberRole === 'owner' ? '#4F46E5' : '#0F766E',
                          }}
                        >
                          {memberRole === 'owner' ? t('ownerBadge') : t('memberBadge')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Set-password link result (shown once after adding) */}
            {setPasswordLink && (
              <section
                className="rounded-2xl p-6 space-y-3"
                style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
              >
                <h2 className="font-semibold" style={{ color: '#15803D' }}>{t('successTitle')}</h2>
                <p className="text-sm" style={{ color: '#166534' }}>
                  {t('successBody', { email: addedEmail })}
                </p>
                <div
                  className="rounded-lg p-3 text-xs font-mono break-all"
                  style={{ background: 'white', border: '1px solid #BBF7D0', color: '#374151' }}
                >
                  {setPasswordLink}
                </div>
                <p className="text-xs" style={{ color: '#6B7280' }}>{t('linkNote')}</p>
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 rounded-full text-sm font-medium"
                  style={{ background: '#0F2044', color: 'white' }}
                >
                  {copied ? t('copied') : t('copyLink')}
                </button>
              </section>
            )}

            {/* Add member form */}
            <section className="rounded-2xl bg-white p-6 space-y-4" style={{ border: '1px solid #E5E7EB' }}>
              <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('addTitle')}</h2>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
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

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
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
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
                  {t('role')}
                </label>
                <div className="space-y-2">
                  {(['member', 'owner'] as const).map((r) => (
                    <label key={r} className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        value={r}
                        checked={role === r}
                        onChange={() => setRole(r)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium" style={{ color: '#0F2044' }}>
                          {r === 'member' ? t('roleMember') : t('roleOwner')}
                        </p>
                        <p className="text-xs" style={{ color: '#6B7280' }}>
                          {r === 'member' ? t('roleMemberDesc') : t('roleOwnerDesc')}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={handleAdd}
                disabled={saving || !email.trim() || !fullName.trim()}
                className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                style={{ background: '#0F2044' }}
              >
                {saving ? t('saving') : t('save')}
              </button>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
