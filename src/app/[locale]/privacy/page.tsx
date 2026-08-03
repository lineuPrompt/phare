import LegalDocumentPage from '@/components/legal/LegalDocumentPage';

// Public by construction: no /api/me fetch, no auth guard. Content lives in
// src/content/legal/privacy.{en,fr}.ts — edit the copy there, never here.
export default function PrivacyPage() {
  return <LegalDocumentPage doc="privacy" />;
}
