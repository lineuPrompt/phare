// ---------------------------------------------------------------------------
// The Privacy Policy, in English and French — one copy, read by the web
// /privacy page (through src/content/legal) and by the mobile app's Privacy
// screen (Apple 5.1.1(i): the policy must be reachable inside the app).
//
// Moved here verbatim from src/content/legal/privacy.{en,fr}.ts on 2026-10-01
// so the app can show it without importing the web src/ (CLAUDE.md §2) and
// without a second copy that could drift. The text is unchanged; edits still
// need the founder's (and counsel's) sign-off, as before.
//
// Because this is @phare/core, it ships in the mobile bundle and is scanned by
// apps/mobile's sourceCompliance and bundle:check like any app string.
//
// `**bold**` is the only markup; both renderers turn it into bold text.
// ---------------------------------------------------------------------------

/** Shape of a legal document. The web's other legal documents use the same type. */
export type LegalSection = {
  /**
   * Stable, locale-independent identifier. It is the anchor in the URL, and it
   * is what the parity test compares across locales — so it must NEVER be
   * translated, and must not change once published (an external link or a
   * regulator's citation may point at it).
   */
  id: string;
  heading: string;
  /** One string per paragraph. Rendered as separate <p> elements. */
  body: string[];
};

export type LegalDocument = {
  title: string;
  /**
   * Shown to the reader. Keep in step with CURRENT_LEGAL_VERSION in
   * src/lib/legalVersions.ts when the substance changes — a document claiming
   * one date while consent is recorded against another is the exact ambiguity
   * the version column exists to remove.
   */
  lastUpdated: string;
  /** Optional lead paragraphs before the first numbered section. */
  intro?: string[];
  sections: LegalSection[];
};

const privacyEn: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: '2026-08-03',
  intro: [
    'Phare is operated by **Lineu Prompt Graeff**, a sole proprietor based in Quebec, Canada.',
    'This policy explains what we collect, where it lives, who else sees it, and what you can do about it. It is written to be read, not skimmed past. If anything here is unclear, write to **support@phare.money**.',
  ],
  sections: [
    {
      id: 'officer',
      heading: 'Privacy officer',
      body: [
        'Under Quebec’s Act respecting the protection of personal information in the private sector (Law 25), we are required to name a person responsible for the protection of your personal information.',
        'That person is **Lineu Prompt Graeff**, reachable at **support@phare.money**.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      body: [
        '**Account information.** Your name, email address, and password (stored hashed — we never see it). Your preferred language.',
        '**Financial information you enter.** Transactions, account balances, budgets, goals, reserve fund provisions, recurring bills, credit card statement dates, and income amounts and schedules. This is the substance of the product: Phare cannot help you without it.',
        '**Household information.** Which household you belong to, your role in it (owner or member), and the names of people in your household — including people who have no login and exist only so expenses can be attributed to them.',
        '**Usage information.** A record of significant actions — completing onboarding, opening your monthly review, creating a goal, viewing your timeline. We use this to understand whether Phare is actually useful, not to build a profile of you.',
        '**Technical information.** Your IP address is processed briefly when you use the sign-up and plan-generation pages, to limit abuse of those pages. It is held in memory only, for a matter of minutes, and is not written to our database.',
      ],
    },
    {
      id: 'what-we-dont-collect',
      heading: 'What we don’t collect',
      body: [
        '**We do not connect to your bank.** Phare has no access to your bank accounts, no read-only credentials, no aggregator. Everything in Phare is there because you or someone in your household entered it or uploaded it.',
        '**We do not keep your uploaded files.** When you upload a spreadsheet during onboarding, it is read in memory and discarded. We record that an import happened and what it produced — we do not store the file. There is no copy of your spreadsheet sitting on our servers.',
        '**We do not sell your data, and we do not advertise.** Phare has no advertisers, no data partners, and no analytics companies embedded in it.',
      ],
    },
    {
      id: 'data-location',
      heading: 'Where your data lives',
      body: [
        'Your data is stored with **Supabase**, our database and authentication provider, in the **AWS Canada (Central) region — ca-central-1, located in Montreal, Quebec**.',
        'Your financial data is stored in Canada. This was a deliberate choice and we intend to keep it that way.',
      ],
    },
    {
      id: 'ai-processing',
      heading: 'How the AI works, and what it sees',
      body: [
        'Phare’s monthly review and financial plan are generated by **Anthropic’s Claude**, an AI service operated by Anthropic PBC in the United States.',
        '**This means your household’s financial information is sent outside Canada.** When a plan or review is generated, Phare sends Claude a summary of your household’s finances — income totals, expense totals, category spending, goal targets, debt payoff figures, reserve fund provisions, and similar. It is sent over an encrypted connection, used to produce your text, and Anthropic does not use it to train their models.',
        'We want to be direct about this because it is the single most significant thing to know about how Phare works. If you are not comfortable with your financial summary being processed by an AI service in the United States, Phare is not the right product for you.',
        '**What the AI does not do:** it does not calculate your numbers. Every dollar figure in your plan and review is computed by Phare’s own code from your ledger. The AI writes the words around numbers it is given — it is never asked to produce a goal, a reserve fund, or a payoff date as data, so it cannot introduce one. Its prose is additionally checked for specific known failure modes, and rejected and regenerated when one is detected.',
      ],
    },
    {
      id: 'household-visibility',
      heading: 'Everyone in your household sees everything',
      body: [
        'Phare is built for households managing money together. **There is no private data inside a household.** Every member — owner or member — can see every transaction, every account, every goal, and every monthly review, regardless of who entered it or whose income it is.',
        'Invite someone to your household only if you are comfortable with them seeing all of it.',
      ],
    },
    {
      id: 'sub-processors',
      heading: 'Who else sees your data',
      body: [
        'We share your information only with the service providers that make Phare work:',
        '**Supabase** — database, authentication, hosting of your data (Canada)',
        '**Anthropic** — AI generation of plans and reviews, as described above (United States)',
        '**Vercel** — application hosting (United States; your financial data is not stored there)',
        '**Brevo** — sending account emails such as password resets and household invitations (European Union; receives your email address and name, not your financial data)',
        '**Stripe** — payment processing, once paid subscriptions are available (receives your billing information; Phare does not store your card number)',
        'We do not share your data with anyone else, except where we are legally required to.',
      ],
    },
    {
      id: 'retention-member-deletion',
      heading: 'If you leave a household that continues to exist',
      body: [
        'We keep your data for as long as your account exists. When you delete your account, what happens depends on whether you are the last person in your household. **These two cases have genuinely different outcomes and we want to be precise about them.**',
        'If one person leaves and another stays, we erase your identity but not the household’s financial records:',
        'Your login, name, and email address are deleted.',
        'Your entry in the household is kept but relabelled, with your name removed. This is necessary because transactions in the household are attributed to it; removing it would corrupt the remaining household’s records.',
        'The household’s transactions, budgets, and recurring bills stay. These are equally the other members’ financial records, and they did not ask for them to be destroyed.',
        'Monthly reviews and plans generated for the household stay, with your account no longer linked to them. Because these are written in plain language from your household’s figures, a first name may appear inside the text of an older review.',
        'Your usage records stay, with your identity removed from them.',
        '**We retain your email address in a deletion log**, recording that a deletion was requested and completed. This is an audit record, kept so that a deletion can be proven and so that a partially failed deletion can be found and finished. It is deleted if the household itself is later deleted.',
        'So: if you leave a continuing household, the household still holds financial records that describe things you did — amounts, dates, categories — without your name, email, or login. We think this is the right balance between your right to be forgotten and the other members’ right to their own records, but you should know it before you decide.',
      ],
    },
    {
      id: 'retention-household-deletion',
      heading: 'If you are the only person in your household',
      body: [
        'Deleting your account deletes everything: your household, your accounts, your transactions, your goals, your reviews, your usage records, the deletion log described above, and your login. Nothing survives.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      body: [
        'Under Quebec’s Law 25 and Canada’s PIPEDA, you have the right to:',
        '**Access** the personal information we hold about you.',
        '**Correct** it if it is inaccurate. Most of it you can edit directly in the app.',
        '**Delete** your account, from the Household page. See above for exactly what deletion does.',
        '**Take your data with you.** The Household page has an export that downloads every transaction in your household as a CSV file you can open in Excel or Google Sheets.',
        '**Withdraw your consent**, which in practice means deleting your account.',
        '**Complain** to the Commission d’accès à l’information du Québec if you believe we have mishandled your information: cai.gouv.qc.ca',
        'To exercise any of these, write to **support@phare.money**. We will respond within 30 days.',
      ],
    },
    {
      id: 'security',
      heading: 'Security',
      body: [
        'Your password is hashed and we never see it. Data is encrypted in transit and at rest. Access to your household’s data is enforced at the database level, so one household’s data cannot be read by another even if the application had a bug.',
        'We do not yet offer two-factor authentication. We intend to add it.',
        'No system is perfectly secure. If a breach occurs that presents a risk of serious injury, we will notify you and the Commission d’accès à l’information as Law 25 requires.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      body: [
        'Phare is for adults managing a household. You must be 18 or older to create an account. We do not knowingly collect information from children. Families often name their children in the app — for a child’s expenses, or an education savings goal — but a child has no account and no login.',
      ],
    },
    {
      id: 'changes',
      heading: 'Changes to this policy',
      body: [
        'If we change this policy in a way that matters, we will ask you to review and accept it the next time you sign in. Minor corrections — a typo, a clarified sentence — will be made without asking.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      body: [
        '**support@phare.money**',
        'Lineu Prompt Graeff, sole proprietor — Quebec, Canada',
      ],
    },
  ],
};

const privacyFr: LegalDocument = {
  title: 'Politique de confidentialité',
  lastUpdated: '2026-08-03',
  intro: [
    'Phare est exploité par **Lineu Prompt Graeff**, travailleur autonome établi au Québec, Canada.',
    'Cette politique explique ce que nous recueillons, où ces renseignements sont conservés, qui d’autre y a accès et ce que vous pouvez faire à ce sujet. Elle est écrite pour être lue, pas pour être survolée. Si quelque chose n’est pas clair, écrivez-nous à **support@phare.money**.',
  ],
  sections: [
    {
      id: 'officer',
      heading: 'Responsable de la protection des renseignements personnels',
      body: [
        'En vertu de la Loi sur la protection des renseignements personnels dans le secteur privé (loi 25), nous devons désigner une personne responsable de la protection de vos renseignements personnels.',
        'Cette personne est **Lineu Prompt Graeff**, joignable à **support@phare.money**.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: 'Ce que nous recueillons',
      body: [
        '**Renseignements de compte.** Votre nom, votre adresse courriel et votre mot de passe (conservé sous forme hachée — nous ne le voyons jamais). Votre langue d’affichage.',
        '**Renseignements financiers que vous saisissez.** Transactions, soldes de comptes, budgets, objectifs, provisions du fonds de réserve, factures récurrentes, dates de relevé de carte de crédit, ainsi que les montants et la fréquence de vos revenus. C’est la matière même du produit : Phare ne peut pas vous aider sans ces renseignements.',
        '**Renseignements sur le ménage.** Le ménage auquel vous appartenez, votre rôle (propriétaire ou membre) et les noms des personnes de votre ménage — y compris celles qui n’ont pas de compte et qui existent uniquement pour qu’on puisse leur attribuer des dépenses.',
        '**Renseignements d’utilisation.** Un registre des actions importantes — avoir terminé la configuration, ouvert votre bilan mensuel, créé un objectif, consulté votre échéancier. Nous nous en servons pour savoir si Phare vous est réellement utile, pas pour dresser votre profil.',
        '**Renseignements techniques.** Votre adresse IP est traitée brièvement lorsque vous utilisez les pages d’inscription et de génération de plan, afin d’en limiter l’usage abusif. Elle n’est conservée qu’en mémoire, pendant quelques minutes, et n’est jamais inscrite dans notre base de données.',
      ],
    },
    {
      id: 'what-we-dont-collect',
      heading: 'Ce que nous ne recueillons pas',
      body: [
        '**Nous ne nous connectons pas à votre banque.** Phare n’a aucun accès à vos comptes bancaires, aucun identifiant en lecture seule, aucun agrégateur. Tout ce qui se trouve dans Phare y est parce que vous ou quelqu’un de votre ménage l’a saisi ou téléversé.',
        '**Nous ne conservons pas vos fichiers téléversés.** Lorsque vous téléversez un chiffrier lors de la configuration, il est lu en mémoire puis écarté. Nous enregistrons qu’une importation a eu lieu et ce qu’elle a produit — nous ne conservons pas le fichier. Aucune copie de votre chiffrier ne dort sur nos serveurs.',
        '**Nous ne vendons pas vos données et nous n’affichons pas de publicité.** Phare n’a ni annonceurs, ni partenaires de données, ni entreprise d’analyse intégrée.',
      ],
    },
    {
      id: 'data-location',
      heading: 'Où vos données sont conservées',
      body: [
        'Vos données sont hébergées chez **Supabase**, notre fournisseur de base de données et d’authentification, dans la région **AWS Canada (Central) — ca-central-1, située à Montréal, au Québec**.',
        'Vos données financières sont conservées au Canada. C’est un choix délibéré et nous entendons le maintenir.',
      ],
    },
    {
      id: 'ai-processing',
      heading: 'Comment fonctionne l’IA, et ce qu’elle voit',
      body: [
        'Le bilan mensuel et le plan financier de Phare sont générés par **Claude d’Anthropic**, un service d’intelligence artificielle exploité par Anthropic PBC aux États-Unis.',
        '**Cela signifie que les renseignements financiers de votre ménage sont transmis à l’extérieur du Canada.** Lorsqu’un plan ou un bilan est généré, Phare transmet à Claude un sommaire des finances de votre ménage — total des revenus, total des dépenses, dépenses par catégorie, cibles d’objectifs, échéances de remboursement de dettes, provisions du fonds de réserve et données semblables. La transmission est chiffrée, les renseignements servent à rédiger votre texte, et Anthropic ne les utilise pas pour entraîner ses modèles.',
        'Nous tenons à être directs là-dessus, car c’est l’élément le plus important à comprendre sur le fonctionnement de Phare. Si le traitement de votre sommaire financier par un service d’IA établi aux États-Unis vous met mal à l’aise, Phare n’est pas le bon produit pour vous.',
        '**Ce que l’IA ne fait pas :** elle ne calcule pas vos chiffres. Chaque montant de votre plan et de votre bilan est calculé par le code de Phare à partir de votre registre. L’IA rédige les mots autour de chiffres qu’on lui fournit — on ne lui demande jamais de produire un objectif, un fonds de réserve ou une date de remboursement sous forme de données, elle ne peut donc pas en introduire. Son texte est de plus vérifié pour certains problèmes connus, et rejeté puis régénéré lorsqu’un de ces problèmes est détecté.',
      ],
    },
    {
      id: 'household-visibility',
      heading: 'Tout le monde dans votre ménage voit tout',
      body: [
        'Phare est conçu pour les ménages qui gèrent leur argent ensemble. **Il n’y a pas de données privées à l’intérieur d’un ménage.** Chaque membre — propriétaire ou membre — voit chaque transaction, chaque compte, chaque objectif et chaque bilan mensuel, peu importe qui les a saisis ou à qui appartient le revenu.',
        'N’invitez quelqu’un dans votre ménage que si vous êtes à l’aise qu’il voie l’ensemble.',
      ],
    },
    {
      id: 'sub-processors',
      heading: 'Qui d’autre voit vos données',
      body: [
        'Nous partageons vos renseignements uniquement avec les fournisseurs qui font fonctionner Phare :',
        '**Supabase** — base de données, authentification, hébergement de vos données (Canada)',
        '**Anthropic** — génération des plans et bilans par IA, tel que décrit ci-dessus (États-Unis)',
        '**Vercel** — hébergement de l’application (États-Unis; vos données financières n’y sont pas conservées)',
        '**Brevo** — envoi des courriels de compte, comme les réinitialisations de mot de passe et les invitations (Union européenne; reçoit votre adresse courriel et votre nom, pas vos données financières)',
        '**Stripe** — traitement des paiements, une fois les abonnements payants offerts (reçoit vos renseignements de facturation; Phare ne conserve pas votre numéro de carte)',
        'Nous ne partageons vos données avec personne d’autre, sauf si la loi l’exige.',
      ],
    },
    {
      id: 'retention-member-deletion',
      heading: 'Si vous quittez un ménage qui continue d’exister',
      body: [
        'Nous conservons vos données tant que votre compte existe. Lorsque vous supprimez votre compte, ce qui se passe dépend de si vous êtes la dernière personne de votre ménage. **Ces deux cas ont des conséquences réellement différentes et nous tenons à être précis.**',
        'Par exemple, une personne part et l’autre reste : nous effaçons votre identité, mais pas les registres financiers du ménage.',
        'Votre identifiant, votre nom et votre adresse courriel sont supprimés.',
        'Votre inscription dans le ménage est conservée mais renommée, sans votre nom. C’est nécessaire parce que des transactions du ménage y sont rattachées; la retirer corromprait les registres du ménage qui reste.',
        'Les transactions, budgets et factures récurrentes du ménage demeurent. Ce sont tout autant les registres financiers des autres membres, et ils n’ont pas demandé qu’on les détruise.',
        'Les bilans mensuels et les plans générés pour le ménage demeurent, sans que votre compte y soit rattaché. Comme ils sont rédigés en langage clair à partir des chiffres de votre ménage, un prénom peut figurer dans le texte d’un ancien bilan.',
        'Vos registres d’utilisation demeurent, sans votre identité.',
        '**Nous conservons votre adresse courriel dans un journal de suppression**, attestant qu’une suppression a été demandée et effectuée. C’est une trace de vérification, conservée pour qu’une suppression puisse être prouvée et qu’une suppression partiellement échouée puisse être retrouvée et complétée. Elle est supprimée si le ménage lui-même est supprimé plus tard.',
        'Donc : si vous quittez un ménage qui continue, ce ménage conserve des registres financiers décrivant des gestes que vous avez posés — montants, dates, catégories — sans votre nom, votre courriel ni votre identifiant. Nous croyons que c’est le juste équilibre entre votre droit à l’oubli et le droit des autres membres à leurs propres registres, mais vous devez le savoir avant de décider.',
      ],
    },
    {
      id: 'retention-household-deletion',
      heading: 'Si vous êtes seul dans votre ménage',
      body: [
        'Supprimer votre compte supprime tout : votre ménage, vos comptes, vos transactions, vos objectifs, vos bilans, vos registres d’utilisation, le journal de suppression décrit ci-dessus et votre identifiant. Rien ne subsiste.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Vos droits',
      body: [
        'En vertu de la loi 25 du Québec et de la LPRPDE fédérale, vous avez le droit :',
        '**D’accéder** aux renseignements personnels que nous détenons à votre sujet.',
        '**De les corriger** s’ils sont inexacts. Vous pouvez modifier la plupart d’entre eux directement dans l’application.',
        '**De supprimer** votre compte, depuis la page Ménage. Voyez plus haut ce que la suppression fait exactement.',
        '**D’emporter vos données.** La page Ménage offre une exportation qui télécharge toutes les transactions de votre ménage dans un fichier CSV, ouvrable dans Excel ou Google Sheets.',
        '**De retirer votre consentement**, ce qui revient en pratique à supprimer votre compte.',
        '**De porter plainte** à la Commission d’accès à l’information du Québec si vous estimez que nous avons mal traité vos renseignements : cai.gouv.qc.ca',
        'Pour exercer l’un de ces droits, écrivez à **support@phare.money**. Nous répondrons dans les 30 jours.',
      ],
    },
    {
      id: 'security',
      heading: 'Sécurité',
      body: [
        'Votre mot de passe est haché et nous ne le voyons jamais. Les données sont chiffrées en transit et au repos. L’accès aux données de votre ménage est appliqué au niveau de la base de données : les données d’un ménage ne peuvent être lues par un autre, même en cas de défaut dans l’application.',
        'Nous n’offrons pas encore l’authentification à deux facteurs. Nous comptons l’ajouter.',
        'Aucun système n’est parfaitement sûr. Si un incident de confidentialité présentant un risque de préjudice sérieux survient, nous vous en aviserons, ainsi que la Commission d’accès à l’information, comme l’exige la loi 25.',
      ],
    },
    {
      id: 'children',
      heading: 'Enfants',
      body: [
        'Phare s’adresse aux adultes qui gèrent un ménage. Vous devez avoir 18 ans ou plus pour créer un compte. Nous ne recueillons pas sciemment de renseignements auprès d’enfants. Les familles nomment souvent leurs enfants dans l’application — pour une dépense ou un objectif d’épargne-études — mais un enfant n’a ni compte ni identifiant.',
      ],
    },
    {
      id: 'changes',
      heading: 'Modifications de cette politique',
      body: [
        'Si nous modifions cette politique de façon importante, nous vous demanderons de la lire et de l’accepter à votre prochaine connexion. Les corrections mineures — une coquille, une phrase clarifiée — seront faites sans vous le demander.',
      ],
    },
    {
      id: 'contact',
      heading: 'Nous joindre',
      body: [
        '**support@phare.money**',
        'Lineu Prompt Graeff, travailleur autonome — Québec, Canada',
      ],
    },
  ],
};

/** The Privacy Policy by locale. */
export const PRIVACY_POLICY: Record<'en' | 'fr', LegalDocument> = { en: privacyEn, fr: privacyFr };
