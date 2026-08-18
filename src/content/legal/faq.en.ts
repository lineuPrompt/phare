import type { LegalDocument } from './types';

/** Founder-written copy, 2026-08-03. Headings are questions. */
const faqEn: LegalDocument = {
  title: 'Common questions',
  lastUpdated: '2026-08-03',
  sections: [
    {
      id: 'what-is-phare',
      heading: 'What is Phare, exactly?',
      body: [
        'Phare is a financial planning system for households. You tell it about your income, your bills, your cards, and your goals, and it keeps a running picture of your money — what came in, what’s going out, what’s coming, and whether the plan is holding.',
        'It is not a bank app and it does not connect to your bank. Everything in it is there because someone in your household put it there. That is deliberate: it means Phare works with the way you already track things, and it means your bank credentials are never involved.',
      ],
    },
    {
      id: 'ai-and-my-numbers',
      heading: 'Is Phare giving me financial advice?',
      body: [
        'No. Phare is a tool that does arithmetic on your numbers and explains the result in plain language. Part of that explanation is written by an AI, which can be wrong.',
        'Nobody at Phare is a financial advisor, accountant, or tax professional. For a decision that matters — a mortgage, an RRSP contribution, consolidating debt — talk to someone qualified who knows your whole situation.',
      ],
    },
    {
      id: 'statement-close-day',
      heading: 'Why did my card charge show up in next month’s tab?',
      body: [
        'Because credit cards bill on a statement cycle, not a calendar month.',
        'Your card has a **statement close day** — say the 27th. Everything you charge from the 28th onward belongs to the next statement, which you’ll pay the following month. So a purchase on July 28th appears under August, because that’s the statement it will land on.',
        'The Cards page shows the cycle it’s working with at the top: the date range and the day you’ll pay it. If a charge seems to be in the wrong month, check that line — the cycle is almost always the reason.',
        'You set your close day and payment day when you set up the card, and you can change them from the card’s envelope editor.',
      ],
    },
    {
      id: 'three-payments',
      heading: 'Why does my mortgage show three payments this month?',
      body: [
        'Because it actually is three payments this month.',
        'If you pay bi-weekly, some months contain three payment dates instead of two. The same is true of a bi-weekly paycheque — four months a year, you get three.',
        'Phare shows real months, never an average. A bi-weekly $1,500 mortgage is $3,000 in most months and $4,500 in a three-payment month, and Phare says $4,500, because that is what will leave your account. Averaging it to $3,250 would make every month look wrong in a different direction.',
        'The same logic applies to income. A three-paycheque month is real extra money, and your monthly review will name it as a one-time event rather than quietly treating it as your new normal.',
      ],
    },
    {
      id: 'reserve-fund',
      heading: 'What is a Reserve Fund?',
      body: [
        'It’s money set aside now for a bill you know is coming later.',
        'Property tax, car registration, insurance renewals, the income tax balance you owe every April — these aren’t emergencies. You know they’re coming and roughly what they cost. The reason they hurt is that they arrive all at once with no account waiting for them, so they land on a credit line.',
        'A reserve fund fixes that by turning a $3,000 annual bill into $250 a month. Phare tracks what each provision costs monthly, when it’s due, and how close it is.',
        'One thing to know: the reserve fund is **one shared account**, not one per bill. Phare shows the total balance and the total monthly provision, not a separate balance for each item.',
      ],
    },
    {
      id: 'fixing-entries',
      heading: 'I entered something wrong. How do I fix it?',
      body: [
        'Find the entry and click **Edit**. You can change the date, description, amount, and category from either the Timeline or the Cards page.',
        'If you need to remove it entirely, click **Delete**. That’s the right move for a duplicate or something that never happened — but don’t delete a real expense just because you’d rather not see it. The plan is only as good as what’s in it.',
        'One thing you’ll notice: **card payments made by the app are not editable.** Those are calculated from your card’s actual charges, so they update themselves. If one looks wrong, the charge behind it is what to fix.',
      ],
    },
    {
      id: 'review-timing',
      heading: 'When does my monthly review appear?',
      body: [
        'At the start of each month, covering the month just finished.',
        'It reads like a short letter, not a report — what went well, what to watch, and one thing to do this month. It’s built from your ledger, so its numbers always match what the rest of the app shows.',
        'You can regenerate it any time from the dashboard if you’ve corrected entries and want it to reflect the fix.',
      ],
    },
    {
      id: 'projections',
      heading: 'How reliable is the projection?',
      body: [
        'It’s an estimate built from what’s already scheduled, and it’s honest about which parts are known and which aren’t.',
        'For a credit card whose statement has already closed, the projection uses the real amount you owe. For a cycle still open, it uses your card budget, because nobody knows yet what the final total will be. Each month tells you which it used.',
        'So a month that’s close is fairly firm; one that’s six months out assumes everything goes to plan. It’s a plan, not a prediction.',
      ],
    },
    {
      id: 'who-can-see-my-household',
      heading: 'Who else can see my household?',
      body: [
        'Everyone in the household sees everything. Every transaction, every account, every goal, every review, regardless of who entered it or whose income it is.',
        'There is no private space inside a household — everything in one is shared, by design. Invite someone only if that’s what you want.',
        'A household holds up to two people with logins. You can also name others — children, for example — so expenses can be attributed to them, without giving them an account.',
      ],
    },
    {
      id: 'data-location',
      heading: 'Where is my data kept?',
      body: [
        'In Canada. Specifically, in the AWS Canada Central region in Montreal, with our database provider Supabase.',
        'One exception you should know about: when Phare generates your plan or monthly review, a summary of your household’s finances is sent to Anthropic’s Claude in the United States to write the text. It’s encrypted in transit and isn’t used to train their models, but it does leave the country. The Privacy Policy explains exactly what gets sent.',
      ],
    },
    {
      id: 'export-my-data',
      heading: 'Can I get my data out?',
      body: [
        'Yes, from the **Household** page. **Export** downloads every transaction in your household as a CSV file you can open in Excel or Google Sheets.',
      ],
    },
    {
      id: 'delete-my-account',
      heading: 'Can I delete my account?',
      body: [
        'Yes, from the same **Household** page. **Delete** removes your account permanently. There’s no undo and no grace period, so export first if you want a copy.',
        'What exactly gets removed depends on whether anyone else is left in your household — the Privacy Policy sets out both cases.',
      ],
    },
    {
      id: 'contact',
      heading: 'Something’s wrong, or I’m stuck',
      body: [
        'Write to **support@phare.money**. A real person reads it.',
        'If it’s a number that looks wrong, tell us what you saw and where — that’s usually enough to find it.',
      ],
    },
  ],
};

export default faqEn;
