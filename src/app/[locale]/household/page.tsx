'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Navbar from '@/components/brand/Navbar';
import Sidebar from '@/components/dashboard/Sidebar';
import SupportLine from '@/components/shared/SupportLine';
import ExportDataSection from '@/components/shared/ExportDataSection';
import DeleteAccountSection from '@/components/household/DeleteAccountSection';
import {
  memberRoleView,
  canPromoteToOwner,
  countAccessHoldingMembers,
  isAtMemberCap,
  HOUSEHOLD_MEMBER_CAP,
} from '@/lib/memberProvisioningHelpers';

type Member = {
  id: string;
  name: string;
  user_id: string | null;
  users?: { email: string; role: string } | null;
  pending?: boolean;
  // Set for someone who deleted their account. Their row survives because the
  // ledger still points at it (transactions.member_id is NO ACTION), so it must
  // render — but as an erased person, never under their real name.
  former?: boolean;
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
  const [addedEmail, setAddedEmail] = useState('');
  const [attachedTo, setAttachedTo] = useState<string | null>(null);
  // Set when the invite's name matches more than one existing name-only
  // member (e.g. two people named "Julia" added via onboarding discovery) —
  // never guessed, the owner picks attach-to-X or create-as-new explicitly.
  const [disambiguation, setDisambiguation] = useState<{ candidates: { id: string; name: string }[] } | null>(null);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<{ id: string; message: string } | null>(null);

  // Capacity is derived from the same helper the route enforces with, so the
  // form and the API can't disagree about the number.
  const atCapacity = isAtMemberCap(countAccessHoldingMembers(members));

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ id: string; message: string } | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<{ id: string; message: string } | null>(null);
  // Two-step: the first click asks, the second commits. Promotion can't be
  // undone from the UI (there is no demote), so it shouldn't be one click away.
  const [confirmPromoteId, setConfirmPromoteId] = useState<string | null>(null);

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

  // overrides carries the owner's explicit choice after a needsDisambiguation
  // response (attachToMemberId or forceNew) — omitted on the first attempt,
  // when match-before-create runs on the server and decides for itself
  // whenever the result is unambiguous.
  const handleAdd = async (overrides?: { attachToMemberId?: string; forceNew?: boolean }) => {
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/household/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim(), role, ...overrides }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to add member'); return; }

      if (data.needsDisambiguation) {
        setDisambiguation({ candidates: data.candidates });
        return;
      }

      setDisambiguation(null);
      setAttachedTo(data.attached ? (data.attachedTo as string) : null);
      setAddedEmail(data.resent ? `resent:${email.trim()}` : email.trim());
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

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setRevokeError(null);
    try {
      const res = await fetch(`/api/household/members/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setRevokeError({ id, message: data.error ?? t('revokeFailed') });
        return;
      }
      setConfirmRevokeId(null);
      fetch('/api/household/members')
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []));
    } catch (err) {
      setRevokeError({ id, message: err instanceof Error ? err.message : t('revokeFailed') });
    } finally {
      setRevokingId(null);
    }
  };

  const handlePromote = async (id: string) => {
    setPromotingId(id);
    setPromoteError(null);
    try {
      const res = await fetch(`/api/household/members/${id}/promote`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        // Surface the server's reason — "they haven't set their password yet"
        // is the whole point of the guard and useless if hidden.
        setPromoteError({ id, message: data.error ?? t('promoteFailed') });
        return;
      }

      setConfirmPromoteId(null);
      fetch('/api/household/members')
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []));
    } catch (err) {
      setPromoteError({ id, message: err instanceof Error ? err.message : t('promoteFailed') });
    } finally {
      setPromotingId(null);
    }
  };

  const handleResend = async (id: string) => {
    setResendingId(id);
    setResendError(null);
    try {
      const res = await fetch(`/api/household/members/${id}/resend`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        const message = typeof data.retryAfterSeconds === 'number'
          ? t('resendRateLimited', { seconds: data.retryAfterSeconds })
          : (data.error ?? t('resendFailed'));
        setResendError({ id, message });
        return;
      }

      setDisambiguation(null);
      setAttachedTo(null);
      setAddedEmail(`resent:${data.email}`);

      fetch('/api/household/members')
        .then((r) => r.json())
        .then((d) => setMembers(d.members ?? []));
    } catch (err) {
      setResendError({ id, message: err instanceof Error ? err.message : t('resendFailed') });
    } finally {
      setResendingId(null);
    }
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

      <div className="flex flex-col md:flex-row">
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
                    // Never `?? 'member'`. An unreadable or missing role is
                    // 'unknown' — defaulting it to a real role is what made
                    // two owners render as one owner and one member.
                    const roleView = memberRoleView(m);
                    return (
                      <li key={m.id} className="py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p
                              className="text-sm font-medium"
                              style={{ color: m.former ? '#9CA3AF' : '#0F2044' }}
                            >
                              {/* A tombstoned row's stored name is the neutral
                                  placeholder written by the deletion function,
                                  not a display string — the label comes from
                                  the `former` flag so it is translated, and so
                                  the erased person's real name is never shown
                                  again. */}
                              {m.former ? t('formerName') : m.name}
                              {isMe && !m.former && (
                                <span className="ml-2 text-xs" style={{ color: '#9CA3AF' }}>
                                  ({t('you')})
                                </span>
                              )}
                            </p>
                            {m.former ? null : m.users?.email ? (
                              <p className="text-xs" style={{ color: '#6B7280' }}>{m.users.email}</p>
                            ) : m.user_id ? (
                              // Has an account, but we couldn't read its row.
                              // Say that, rather than rendering nothing and
                              // letting it look like the person has no email.
                              <p className="text-xs italic" style={{ color: '#9CA3AF' }}>
                                {t('detailsUnavailable')}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {m.former && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{ background: '#F3F4F6', color: '#6B7280' }}
                              >
                                {t('formerBadge')}
                              </span>
                            )}
                            {m.pending && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{ background: '#FEF3C7', color: '#92400E' }}
                              >
                                {t('pendingBadge')}
                              </span>
                            )}
                            {/* No role badge for a former member. Their user_id
                                is NULL, so roleView reads 'not_invited' — which
                                is exactly backwards: they were invited, they
                                signed in, and then they left. The Former badge
                                above already says what happened. */}
                            {!m.former && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={
                                  roleView === 'owner'  ? { background: '#EEF2FF', color: '#4F46E5' } :
                                  roleView === 'member' ? { background: '#F0FDFD', color: '#0F766E' } :
                                                          { background: '#F3F4F6', color: '#6B7280' }
                                }
                              >
                                {roleView === 'owner'       ? t('ownerBadge')
                                  : roleView === 'member'   ? t('memberBadge')
                                  : roleView === 'not_invited' ? t('notInvitedBadge')
                                  : t('roleUnknownBadge')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Promote to owner. Only for an active member — a
                            pending person would hold the role without being
                            able to sign in and use it. The server enforces
                            this too; hiding the button is not the guard. */}
                        {canPromoteToOwner(m) && (
                          <div className="mt-2">
                            {confirmPromoteId === m.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs" style={{ color: '#6B7280' }}>
                                  {t('promoteConfirm', { name: m.name })}
                                </span>
                                <button
                                  onClick={() => handlePromote(m.id)}
                                  disabled={promotingId === m.id}
                                  className="text-xs font-medium px-3 py-1.5 rounded-full text-white cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                                  style={{ background: '#0F2044' }}
                                >
                                  {promotingId === m.id ? t('promoting') : t('promoteYes')}
                                </button>
                                <button
                                  onClick={() => { setConfirmPromoteId(null); setPromoteError(null); }}
                                  className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-90 transition-all"
                                  style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                                >
                                  {t('promoteCancel')}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setConfirmPromoteId(m.id); setPromoteError(null); }}
                                className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-90 transition-all"
                                style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                              >
                                {t('promoteToOwner')}
                              </button>
                            )}
                            {promoteError?.id === m.id && (
                              <p className="text-xs mt-1" style={{ color: '#DC2626' }}>{promoteError.message}</p>
                            )}
                          </div>
                        )}

                        {m.pending && (
                          <div className="mt-2">
                            <button
                              onClick={() => handleResend(m.id)}
                              disabled={resendingId === m.id}
                              className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                              style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                            >
                              {resendingId === m.id ? t('resending') : t('resendInvite')}
                            </button>
                            {/* Revoke a never-activated invite. Frees the
                                capped slot — without this a typo'd email
                                would consume one of two slots for good. */}
                            {confirmRevokeId === m.id ? (
                              <span className="inline-flex flex-wrap items-center gap-2 ml-2">
                                <span className="text-xs" style={{ color: '#6B7280' }}>
                                  {t('revokeConfirm', { name: m.name })}
                                </span>
                                <button
                                  onClick={() => handleRevoke(m.id)}
                                  disabled={revokingId === m.id}
                                  className="text-xs font-medium px-3 py-1.5 rounded-full text-white cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                                  style={{ background: '#B91C1C' }}
                                >
                                  {revokingId === m.id ? t('revoking') : t('revokeYes')}
                                </button>
                                <button
                                  onClick={() => { setConfirmRevokeId(null); setRevokeError(null); }}
                                  className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-90 transition-all"
                                  style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                                >
                                  {t('promoteCancel')}
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setConfirmRevokeId(m.id); setRevokeError(null); }}
                                className="text-xs font-medium px-3 py-1.5 rounded-full cursor-pointer hover:opacity-90 transition-all ml-2"
                                style={{ border: '1.5px solid #FECACA', color: '#B91C1C', background: 'white' }}
                              >
                                {t('revokeInvite')}
                              </button>
                            )}
                            {resendError?.id === m.id && (
                              <p className="text-xs mt-1" style={{ color: '#DC2626' }}>{resendError.message}</p>
                            )}
                            {revokeError?.id === m.id && (
                              <p className="text-xs mt-1" style={{ color: '#DC2626' }}>{revokeError.message}</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Email-sent confirmation (shown once after adding or resending) */}
            {addedEmail && (() => {
              const isResent = addedEmail.startsWith('resent:');
              const displayEmail = isResent ? addedEmail.slice(7) : addedEmail;
              return (
                <section
                  className="rounded-2xl p-6 space-y-2"
                  style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
                >
                  <h2 className="font-semibold" style={{ color: '#15803D' }}>
                    {isResent ? t('resentTitle') : attachedTo ? t('attachedTitle') : t('successTitle')}
                  </h2>
                  <p className="text-sm" style={{ color: '#166534' }}>
                    {isResent
                      ? t('resentBody', { email: displayEmail })
                      : attachedTo
                        ? t('attachedBody', { name: attachedTo, email: displayEmail })
                        : t('successBody', { email: displayEmail })}
                  </p>
                </section>
              );
            })()}

            {/* Ambiguous name match — never guessed, the owner picks. */}
            {disambiguation && (
              <section className="rounded-2xl p-6 space-y-3" style={{ background: '#FFFBEB', border: '1.5px solid #F5A623' }}>
                <p className="text-sm font-medium" style={{ color: '#92400E' }}>
                  {t('disambiguation.prompt', { name: fullName.trim() })}
                </p>
                <div className="space-y-2">
                  {disambiguation.candidates.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleAdd({ attachToMemberId: c.id })}
                      disabled={saving}
                      className="w-full text-left px-4 py-2.5 rounded-lg text-sm cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                      style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                    >
                      {t('disambiguation.attachTo', { name: c.name })}
                    </button>
                  ))}
                  <button
                    onClick={() => handleAdd({ forceNew: true })}
                    disabled={saving}
                    className="w-full text-left px-4 py-2.5 rounded-lg text-sm cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                    style={{ border: '1.5px solid #D1D5DB', color: '#0F2044', background: 'white' }}
                  >
                    {t('disambiguation.createNew')}
                  </button>
                </div>
              </section>
            )}

            {/* At capacity: say so. A form that silently disappears reads as
                a bug, and the server rejects a third invite regardless — this
                only explains why the form isn't there. */}
            {atCapacity ? (
              <section className="rounded-2xl p-6" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <h2 className="font-semibold mb-1" style={{ color: '#0F2044' }}>{t('addTitle')}</h2>
                <p className="text-sm" style={{ color: '#6B7280' }}>
                  {t('memberCapReached', { cap: HOUSEHOLD_MEMBER_CAP })}
                </p>
              </section>
            ) : (
            /* Add member form */
            <section className="rounded-2xl bg-white p-6 space-y-4" style={{ border: '1px solid #E5E7EB' }}>
              <h2 className="font-semibold" style={{ color: '#0F2044' }}>{t('addTitle')}</h2>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
                  {t('fullName')}
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setDisambiguation(null); }}
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
                  onChange={(e) => { setEmail(e.target.value); setDisambiguation(null); }}
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

              {error && (
                <>
                  <p className="text-sm text-red-600">{error}</p>
                  <SupportLine className="text-xs" />
                </>
              )}

              {!disambiguation && (
                <button
                  onClick={() => handleAdd()}
                  disabled={saving || !email.trim() || !fullName.trim()}
                  className="w-full py-3 rounded-full text-white font-semibold cursor-pointer hover:opacity-90 transition-all disabled:opacity-50"
                  style={{ background: '#0F2044' }}
                >
                  {saving ? t('saving') : t('save')}
                </button>
              )}
            </section>
            )}

            <ExportDataSection locale={locale} />

            {/* Last on the page, after the promote control it points at when
                the last owner is blocked. */}
            <DeleteAccountSection locale={locale} />
          </div>
        </div>
      </div>
    </main>
  );
}
