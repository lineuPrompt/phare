import { redirect } from 'next/navigation';

// Goals moved into /savings alongside the Reserve Fund (2026-08-08). Kept as
// a redirect rather than deleted: this path is deep-linked from the
// dashboard, from Timeline's transfer rows, and from any bookmark a family
// already has. Permanent — the page is not coming back to this URL.
//
// 2026-08-12: the destination page is now TITLED "Goals", so this file reads
// backwards — /goals redirects away from Goals. Deliberate, and reviewed:
// making /goals canonical would mean moving the page and rewriting every
// inbound link (Sidebar, both dashboard cards, Timeline's transfer rows) to
// buy a tidier address bar. The redirect costs one hop and nothing else.
export default async function GoalsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/savings`);
}
