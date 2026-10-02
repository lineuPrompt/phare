import { PRIVACY_POLICY } from '@phare/core';
import type { LegalDocument } from './types';

/**
 * The Privacy Policy now lives in @phare/core (privacyPolicy.ts) so the mobile
 * app shows the same text without importing web src/. Edit it there. Section
 * ids are still asserted identical to privacy.fr's by legalContent.test.ts.
 */
const privacyEn: LegalDocument = PRIVACY_POLICY.en;

export default privacyEn;
