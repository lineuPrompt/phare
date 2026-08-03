import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

/**
 * SECTION LIST IS THE DRAFTING CHECKLIST.
 *
 * Every section below exists because the application actually does the thing it
 * names — these are not generic policy headings. Deleting one means the policy
 * stops describing real behaviour. See the handoff for the code that motivates
 * each.
 */
const privacyEn: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: '2026-08-03',
  intro: [
    P + 'Introduction — who operates Phare, what this document covers, and the plain-language promise.',
  ],
  sections: [
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      body: [
        P + 'Account details (name, email), household composition, and every financial figure entered or imported — income, expenses, accounts, balances, goals, reserve funds.',
        P + 'NOTE FOR DRAFTING: IP addresses are processed transiently by the rate limiters on the unauthenticated onboarding routes. Short-lived and in-memory, but it is still personal data and should be named.',
      ],
    },
    {
      id: 'uploaded-files',
      heading: 'Files you upload',
      body: [
        P + 'The onboarding spreadsheet is parsed in memory and never written to storage — file_imports records that an import happened, not the file itself. This is a genuinely strong claim and worth stating plainly, because most products cannot make it.',
      ],
    },
    {
      id: 'ai-processing',
      heading: 'How your information is used by AI',
      body: [
        P + 'Household financial figures are sent to Anthropic to generate the plan, the monthly review, and the top recommendation. This is the disclosure most likely to be missed and the one a reader most needs.',
        P + 'State what is sent (aggregated figures and line labels), what is not, and that the AI never invents or alters the numbers — code owns the arithmetic.',
      ],
    },
    {
      id: 'sub-processors',
      heading: 'Service providers',
      body: [
        P + 'Supabase (database, authentication), Vercel (hosting), Anthropic (AI), Brevo (transactional email). Name each and what it touches.',
      ],
    },
    {
      id: 'data-location',
      heading: 'Where your information is stored',
      body: [
        P + 'CONFIRM BEFORE PUBLISHING: the Supabase project region, and that AI processing happens outside Canada. Quebec Law 25 requires a privacy impact assessment for transfers outside Quebec — this section must be accurate, not aspirational.',
      ],
    },
    {
      id: 'activity-data',
      heading: 'Usage and activity',
      body: [
        P + 'Phare records product events (onboarding completed, timeline opened, monthly review viewed) to understand whether the product helps. Household-scoped, and it SURVIVES an individual member deleting their account — events.user_id becomes null rather than the row being removed.',
      ],
    },
    {
      id: 'retention-member-deletion',
      heading: 'When one member deletes their account',
      body: [
        P + 'The honest account: the login is destroyed and the name is replaced, but the household keeps the financial records that member entered, because they are the household\'s records. The member row survives, relabelled.',
        P + 'MUST STATE: a deletion request record retains the departing member\'s email address as an audit trail. Do not claim deletion removes everything — it does not, and the code will contradict you.',
      ],
    },
    {
      id: 'retention-household-deletion',
      heading: 'When the household is deleted',
      body: [
        P + 'The other story: deleting the household destroys everything by cascade, including the deletion-request records and their retained emails. This is the branch where "everything is removed" is true.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      body: [
        P + 'Access, correction, deletion, portability. Portability is already real — the CSV export. Deletion is already real — both cases above. Name the response window.',
      ],
    },
    {
      id: 'security',
      heading: 'How we protect your information',
      body: [
        P + 'Encryption in transit and at rest, row-level security scoping every query to one household, and the member cap. Avoid absolute guarantees.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies',
      body: [
        P + 'Authentication session cookies only. No advertising or third-party analytics cookies — state it plainly if it stays true.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      body: [
        P + 'How revisions are published, and that a substantive change requires accepting again before continuing to use Phare.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact us',
      body: [
        P + 'support@phare.money, and the privacy officer required under Quebec Law 25.',
      ],
    },
  ],
};

export default privacyEn;
