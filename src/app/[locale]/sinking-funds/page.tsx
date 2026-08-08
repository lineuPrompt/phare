import { redirect } from 'next/navigation';

// The Reserve Fund moved into /savings alongside Goals (2026-08-08). Kept as
// a redirect rather than deleted, same reasoning as goals/page.tsx: existing
// bookmarks and the dashboard's SinkingFundsCard link both point here.
export default async function SinkingFundsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/savings`);
}
