import type { LegalDocument } from './types';

/** Section ids MUST match terms.en.ts exactly — asserted by legalContent.test.ts.
 *  Same billing caveat as the English file: no Stripe integration exists. */
const termsFr: LegalDocument = {
  title: 'Conditions d’utilisation',
  lastUpdated: '2026-08-03',
  intro: [
    'Phare est exploité par **Lineu Prompt Graeff**, travailleur autonome établi au Québec, Canada (« nous »).',
    'En créant un compte, vous acceptez ces conditions. Elles sont rédigées simplement, volontairement. Questions : **support@phare.money**.',
  ],
  sections: [
    {
      id: 'what-phare-is',
      heading: 'Ce qu’est Phare',
      body: [
        'Phare est un outil d’accompagnement financier pour les ménages. Vous y saisissez vos revenus, vos dépenses, vos comptes et vos objectifs, et Phare vous aide à voir où va votre argent, ce qui s’en vient et si votre plan fonctionne. Une partie du contenu est générée par un service d’intelligence artificielle, qui rédige un bilan mensuel et un plan en langage clair.',
      ],
    },
    {
      id: 'not-financial-advice',
      heading: 'Phare n’est pas un conseil financier',
      body: [
        '**C’est l’élément le plus important de ce document.**',
        'Nous ne sommes ni conseiller financier, ni planificateur financier, ni comptable, ni fiscaliste, ni courtier hypothécaire, ni avocat, et Phare n’est inscrit ni titulaire d’aucun permis à ces titres. Rien de ce que produit Phare ne constitue un conseil financier, en placement, fiscal ou juridique.',
        'Les plans, bilans mensuels, recommandations et projections de Phare sont **des outils d’information fondés sur les chiffres que vous saisissez**. Ils sont générés en partie par une intelligence artificielle, qui peut se tromper, mal interpréter une situation et produire un texte qui paraît assuré tout en étant inadapté à votre réalité.',
        '**Chaque décision financière que vous prenez vous appartient, et vous en êtes seul responsable.** Si vous prenez une décision qui compte — une hypothèque, une cotisation REER ou CELI, une consolidation de dettes, tout ce qui a des conséquences fiscales — consultez un professionnel qualifié qui connaît votre situation complète. Phare ne connaît pas votre situation complète. Il connaît ce que vous y avez saisi.',
        'Les projections sont des estimations, pas des promesses. Un solde projeté correspond à ce qui arriverait si les hypothèses se vérifient. Les hypothèses ne se vérifient pas toujours.',
      ],
    },
    {
      id: 'your-data-your-numbers',
      heading: 'Vos données, vos chiffres',
      body: [
        'Phare travaille à partir de ce que vous saisissez. Si un montant est erroné, manquant ou mal catégorisé, le résultat le sera aussi — y compris le plan, le bilan et chaque projection. Nous ne vérifions pas vos saisies auprès de votre banque, puisque Phare ne s’y connecte pas.',
        'Maintenir vos renseignements exacts relève de vous. Le rôle de Phare est d’être juste dans ses calculs sur les chiffres que vous lui donnez.',
      ],
    },
    {
      id: 'accounts-and-households',
      heading: 'Comptes et ménages',
      body: [
        'Vous devez avoir 18 ans ou plus et résider au Canada pour créer un compte.',
        'Phare s’organise autour d’un **ménage**. Un ménage compte au maximum **deux personnes avec un identifiant**. Vous pouvez aussi nommer d’autres personnes — vos enfants, par exemple — pour leur attribuer des dépenses; elles n’ont pas d’identifiant et ne comptent pas dans la limite.',
        '**Toute personne ayant un identifiant dans un ménage voit tout ce qui s’y trouve.** Il n’y a pas de données privées à l’intérieur d’un ménage. N’invitez quelqu’un que si vous êtes à l’aise avec cela.',
        'Il vous revient de protéger votre mot de passe et vous répondez de tout ce qui est fait à partir de votre compte. Écrivez-nous à **support@phare.money** si vous croyez qu’une autre personne y a accès.',
      ],
    },
    {
      id: 'billing',
      heading: 'Tarifs et paiement',
      body: [
        'Phare offre un forfait gratuit et un forfait payant, **Phare Pro**.',
        '**Phare Pro coûte 15 $ CA par mois ou 150 $ CA par année.** Les prix sont en dollars canadiens et les taxes applicables s’ajoutent au moment du paiement. Les paiements sont traités par Stripe; nous ne conservons pas votre numéro de carte.',
        'Les abonnements se renouvellent automatiquement — chaque mois pour les forfaits mensuels, chaque année pour les forfaits annuels — au prix en vigueur au renouvellement. Nous vous préviendrons à l’avance de tout changement de prix, et vous pourrez annuler avant qu’il ne prenne effet.',
        'Certains ménages peuvent recevoir un accès promotionnel ou gratuit pour une période donnée. À la fin de cette période, le compte revient au forfait gratuit à moins que vous ne vous abonniez. Nous ne vous facturerons jamais sans que vous ayez saisi des renseignements de paiement.',
      ],
    },
    {
      id: 'refunds',
      heading: 'Remboursements',
      body: [
        '**Vous pouvez demander un remboursement complet dans les 30 jours suivant tout paiement**, mensuel ou annuel, pour quelque raison que ce soit. Écrivez à **support@phare.money** et nous vous rembourserons.',
        'Passé 30 jours, un paiement n’est pas remboursable, mais vous pouvez annuler en tout temps. L’annulation met fin au prochain renouvellement; vous conservez l’accès jusqu’à la fin de la période déjà payée.',
      ],
    },
    {
      id: 'deletion',
      heading: 'Annulation et suppression',
      body: [
        'Vous pouvez annuler votre abonnement en tout temps depuis l’application. Vous conservez l’accès Pro jusqu’à la fin de la période payée, puis passez au forfait gratuit.',
        'Vous pouvez supprimer votre compte entièrement depuis la page Ménage. La suppression est définitive et sans délai de grâce — nous vous recommandons d’exporter vos données d’abord, ce que la même page permet. Ce que la suppression retire et ce qu’elle conserve est décrit dans notre politique de confidentialité, et diffère selon qu’il reste ou non quelqu’un dans votre ménage.',
      ],
    },
    {
      id: 'availability',
      heading: 'Disponibilité',
      body: [
        'Nous visons à garder Phare fonctionnel et exact. Nous ne promettons pas une disponibilité ininterrompue. Phare dépend de services que nous ne contrôlons pas — hébergement, base de données, courriel et fournisseurs d’IA — et chacun peut connaître une panne.',
        'Nous pouvons modifier, ajouter ou retirer des fonctionnalités. Si nous retirons quelque chose dont vous dépendez, nous tenterons de vous en aviser d’abord.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Usage acceptable',
      body: [
        'N’utilisez pas Phare à des fins illégales. N’essayez pas d’accéder aux données d’autres ménages, de surcharger le service, de l’extraire automatiquement ou d’en faire l’ingénierie inverse. Ne revendez pas l’accès. Ne téléversez pas les renseignements financiers d’une autre personne à son insu.',
        'Nous pouvons suspendre ou fermer un compte qui fait ces choses.',
      ],
    },
    {
      id: 'your-data',
      heading: 'Votre contenu',
      body: [
        'Vos données financières vous appartiennent. Nous n’en revendiquons pas la propriété. Nous les utilisons pour faire fonctionner Phare pour vous — y compris en transmettant un sommaire à notre fournisseur d’IA pour générer votre plan et votre bilan, comme le décrit la politique de confidentialité — et à rien d’autre.',
        'Le logiciel, le design et les textes de Phare nous appartiennent.',
      ],
    },
    {
      id: 'liability',
      heading: 'Limitation de responsabilité',
      body: [
        'Dans la mesure permise par la loi : Phare est fourni tel quel, sans garantie d’aucune sorte. Nous ne sommes pas responsables des pertes financières, paiements manqués, pénalités, conséquences fiscales, occasions perdues ni de tout autre dommage découlant de votre utilisation de Phare ou des décisions que vous avez prises avec lui.',
        'Notre responsabilité totale envers vous, pour toute réclamation, se limite au montant que vous nous avez versé dans les douze mois précédant la réclamation.',
        'Rien ici ne limite les droits que vous confère la Loi sur la protection du consommateur du Québec auxquels il ne peut être renoncé.',
      ],
    },
    {
      id: 'termination',
      heading: 'Fin de cette entente',
      body: [
        'Vous pouvez cesser d’utiliser Phare et supprimer votre compte en tout temps.',
        'Nous pouvons fermer votre compte si vous ne respectez pas ces conditions, ou si nous mettons fin au service. Si nous mettons fin à Phare, nous vous donnerons un préavis raisonnable et le temps d’exporter vos données, et nous rembourserons toute portion inutilisée d’un abonnement payé.',
      ],
    },
    {
      id: 'changes',
      heading: 'Modifications de ces conditions',
      body: [
        'Si nous modifions ces conditions de façon importante, nous vous demanderons de les lire et de les accepter à votre prochaine connexion. Continuer d’utiliser Phare par la suite signifie que vous les acceptez. Si vous ne les acceptez pas, vous pouvez supprimer votre compte et demander le remboursement de toute période payée inutilisée.',
      ],
    },
    {
      id: 'governing-law',
      heading: 'Droit applicable',
      body: [
        'Ces conditions sont régies par les lois du Québec et les lois du Canada qui y sont applicables. Tout litige sera entendu devant les tribunaux du district judiciaire de Montréal, Québec.',
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

export default termsFr;
