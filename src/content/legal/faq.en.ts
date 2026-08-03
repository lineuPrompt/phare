import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

/**
 * Not a legal document — same shape because it renders identically and gets the
 * same both-locales parity guarantee. Headings are questions; body is the answer.
 */
const faqEn: LegalDocument = {
  title: 'Frequently asked questions',
  lastUpdated: '2026-08-03',
  sections: [
    {
      id: 'what-is-phare',
      heading: 'What is Phare?',
      body: [P + 'A budgeting and coaching tool for Canadian families — what it does, in two sentences.'],
    },
    {
      id: 'is-my-data-safe',
      heading: 'Is my financial information safe?',
      body: [P + 'Short answer plus a link to the Privacy Policy. Do not repeat the policy here; they will drift.'],
    },
    {
      id: 'does-it-connect-to-my-bank',
      heading: 'Does Phare connect to my bank?',
      body: [P + 'No. Everything is entered manually or imported from the Phare template. Worth answering early — it is the first question most people have.'],
    },
    {
      id: 'ai-and-my-numbers',
      heading: 'Does the AI see my numbers?',
      body: [P + 'Yes, and say so plainly. Then explain the reassuring part: the AI writes the words, the code does the arithmetic.'],
    },
    {
      id: 'who-can-see-my-household',
      heading: 'Who else can see my household?',
      body: [P + 'Both members see everything. Set this expectation before a spouse is invited, not after.'],
    },
    {
      id: 'export-my-data',
      heading: 'Can I get my data out?',
      body: [P + 'Yes — CSV export of every transaction, any time, from the Household page.'],
    },
    {
      id: 'delete-my-account',
      heading: 'How do I delete my account?',
      body: [P + 'Both cases, briefly: leaving a household versus deleting it. Immediate, no undo.'],
    },
    {
      id: 'what-does-it-cost',
      heading: 'What does Phare cost?',
      body: [P + 'CONFIRM: no billing is implemented yet. Say what is true today.'],
    },
    {
      id: 'quebec-specific',
      heading: 'Does Phare handle Quebec taxes and benefits?',
      body: [P + 'RRSP/RESP/TFSA/CESG awareness and Quebec-specific patterns — describe what the coaching actually accounts for, without overclaiming.'],
    },
    {
      id: 'contact',
      heading: 'How do I get help?',
      body: [P + 'support@phare.money'],
    },
  ],
};

export default faqEn;
