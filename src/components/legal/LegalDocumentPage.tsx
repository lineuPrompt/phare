'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Navbar from '@/components/brand/Navbar';
import { createClient } from '@/lib/supabase';
import { getLegalDocument, type LegalDocumentKey } from '@/content/legal';

/**
 * Renders any legal/informational document from src/content/legal.
 *
 * DELIBERATELY PUBLIC: this component never gates and never redirects. A
 * privacy policy that requires signing in to read is not a privacy policy —
 * and the consent screen links here, so gating it would deadlock a user who
 * cannot proceed until they have read what they are agreeing to.
 *
 * It does read the session, for exactly one thing: where the back link points.
 * That is a read, not a gate — the document body renders identically either
 * way, and the link defaults to the public destination until (and unless) the
 * check resolves to a signed-in user, so a logged-out or offline reader always
 * gets a working link. Nothing here may ever grow into a condition on the
 * content itself.
 *
 * Section ids become heading anchors, so a specific clause can be linked to
 * directly. legalContent.test.ts holds those ids identical across locales, which
 * is what lets an /en/... link survive being opened by a French reader.
 */
/**
 * Renders `**bold**` as <strong>, and nothing else.
 *
 * The copy uses emphasis where it carries weight — "This is the most important
 * thing in this document", "We do not connect to your bank" — and shipping a
 * legal document with the author's emphasis flattened into plain text loses
 * something real. A full markdown renderer is more surface than these documents
 * need, so this handles the one construct the copy actually uses. Anything else
 * (links, lists, headings) must be expressed as plain prose in the content file.
 */
function renderBold(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{part}</span>
  );
}

export default function LegalDocumentPage({ doc }: { doc: LegalDocumentKey }) {
  const t = useTranslations('legal');
  const pathname = usePathname();
  const locale = pathname.startsWith('/fr') ? 'fr' : 'en';
  const document = getLegalDocument(doc, locale);

  // Now that the account menu links here from inside the app, "Back to Phare"
  // pointing at the marketing landing page would eject a signed-in household
  // out of the product — they came from the dashboard to look something up,
  // not to read the sales pitch. Defaults to the public destination, so the
  // link is correct for the whole first render and for anyone signed out.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => { if (!cancelled && data.user) setSignedIn(true); })
      .catch(() => { /* never let a session check affect a public document */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen" style={{ background: '#FAFAF8' }}>
      <Navbar />

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" style={{ color: '#0F2044' }}>
          {document.title}
        </h1>
        <p className="text-sm mb-10" style={{ color: '#6B7280' }}>
          {t('lastUpdated', { date: document.lastUpdated })}
        </p>

        {document.intro && document.intro.length > 0 && (
          <div className="space-y-4 mb-10">
            {document.intro.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed" style={{ color: '#374151' }}>
                {renderBold(p, `intro-${i}`)}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-10">
          {document.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-lg font-semibold mb-3" style={{ color: '#0F2044' }}>
                {section.heading}
              </h2>
              <div className="space-y-3">
                {section.body.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed" style={{ color: '#374151' }}>
                    {renderBold(p, `${section.id}-${i}`)}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-16 pt-8" style={{ borderTop: '1px solid #E5E7EB' }}>
          <Link
            href={signedIn ? `/${locale}/dashboard` : `/${locale}`}
            className="text-sm underline"
            style={{ color: '#0F2044' }}
          >
            {t('backHome')}
          </Link>
        </div>
      </div>
    </main>
  );
}
