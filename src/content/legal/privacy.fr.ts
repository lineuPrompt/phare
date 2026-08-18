import type { LegalDocument } from './types';

/** Section ids MUST match privacy.en.ts exactly — asserted by legalContent.test.ts. */
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

export default privacyFr;
