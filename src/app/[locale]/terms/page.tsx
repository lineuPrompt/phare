import LegalDocumentPage from '@/components/legal/LegalDocumentPage';

// Public by construction: no /api/me fetch, no auth guard. Content lives in
// src/content/legal/terms.{en,fr}.ts — edit the copy there, never here.
export default function TermsPage() {
  return <LegalDocumentPage doc="terms" />;
}
