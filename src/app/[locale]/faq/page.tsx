import LegalDocumentPage from '@/components/legal/LegalDocumentPage';

// Public by construction: no /api/me fetch, no auth guard. Content lives in
// src/content/legal/faq.{en,fr}.ts — edit the copy there, never here.
export default function FaqPage() {
  return <LegalDocumentPage doc="faq" />;
}
