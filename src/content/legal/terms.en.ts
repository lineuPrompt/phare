import { TERMS_OF_SERVICE } from '@phare/core';
import type { LegalDocument } from './types';

/**
 * The Terms of Service now live in @phare/core (termsOfService.ts) so the
 * mobile app shows the same text without importing web src/. Edit them there.
 */
const termsEn: LegalDocument = TERMS_OF_SERVICE.en;

export default termsEn;
