import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

const termsEn: LegalDocument = {
  title: 'Terms of Service',
  lastUpdated: '2026-08-03',
  intro: [
    P + 'Introduction — the agreement between the household and Phare, in plain language.',
  ],
  sections: [
    {
      id: 'acceptance',
      heading: 'Accepting these terms',
      body: [
        P + 'Using Phare means accepting these terms and the Privacy Policy. Acceptance is recorded against the version in force at the time.',
      ],
    },
    {
      id: 'not-financial-advice',
      heading: 'Phare is not a financial advisor',
      body: [
        P + 'THE MOST IMPORTANT SECTION IN THIS DOCUMENT. Phare produces budgets, projections and written coaching, including AI-generated prose that reads like advice from a trusted advisor — that tone is deliberate, and it makes this disclaimer more necessary, not less.',
        P + 'State clearly: not registered financial, tax, or investment advice; projections are estimates; the household decides.',
      ],
    },
    {
      id: 'ai-limitations',
      heading: 'What the AI does and does not do',
      body: [
        P + 'Worth being specific, because the architecture is unusually defensible: all arithmetic is computed in code, and the AI is confined to classification and prose. It never invents a figure, a goal, or a reserve fund.',
        P + 'Also state the limits: generated text can be wrong or unhelpful and should not be relied on alone.',
      ],
    },
    {
      id: 'eligibility',
      heading: 'Who can use Phare',
      body: [
        P + 'Age of majority, Canadian residency if that is the intended market, one household per account.',
      ],
    },
    {
      id: 'accounts-and-households',
      heading: 'Accounts and households',
      body: [
        P + 'A household holds at most two members with sign-in access. Owners can invite and remove; every member sees the household\'s full financial picture — this is shared visibility by design and should not surprise anyone.',
      ],
    },
    {
      id: 'your-data',
      heading: 'Your information',
      body: [
        P + 'The household owns what it enters. Point to the Privacy Policy rather than restating it.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Acceptable use',
      body: [
        P + 'No sharing credentials, no scraping, no attempting to access another household\'s data, no reselling.',
      ],
    },
    {
      id: 'billing',
      heading: 'Trial, subscription and billing',
      body: [
        P + 'CONFIRM BEFORE PUBLISHING: the schema carries subscription_status (trial/active/cancelled/expired) and a Stripe customer id, but no billing is implemented yet. Do not describe charges that cannot occur.',
      ],
    },
    {
      id: 'deletion',
      heading: 'Ending your account',
      body: [
        P + 'Both routes out: a member can delete their own account and leave the household intact, or the household can be deleted entirely. Immediate, with no undo and no grace period — the product says this on screen, so the terms must agree.',
      ],
    },
    {
      id: 'availability',
      heading: 'Availability and changes to the service',
      body: [
        P + 'No uptime guarantee; features may change; notice for material changes.',
      ],
    },
    {
      id: 'liability',
      heading: 'Limitation of liability',
      body: [
        P + 'Standard limitation, drafted against Quebec consumer-protection limits — some exclusions are unenforceable here, so this needs a lawyer\'s eye rather than a template.',
      ],
    },
    {
      id: 'governing-law',
      heading: 'Governing law',
      body: [
        P + 'Quebec law and the courts of the judicial district.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to these terms',
      body: [
        P + 'A substantive revision requires accepting again before continuing to use Phare.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact us',
      body: [P + 'support@phare.money'],
    },
  ],
};

export default termsEn;
