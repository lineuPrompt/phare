import { redirect } from 'next/navigation';

// Goals moved into /savings alongside the Reserve Fund (2026-08-08). Kept as
// a redirect rather than deleted: this path is deep-linked from the
// dashboard, from Timeline's transfer rows, and from any bookmark a family
// already has. Permanent — the page is not coming back to this URL.
export default async function GoalsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/savings`);
}
