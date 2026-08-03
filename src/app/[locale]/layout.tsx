import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';
import type {Metadata} from 'next';
import TermsGuard from '@/components/legal/TermsGuard';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Phare — Your financial lighthouse',
  description: 'AI financial coach for Canadian families.',
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          {/* One consent check for every page. Renders nothing; exempts the
              public and pre-consent routes itself. */}
          <TermsGuard />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}