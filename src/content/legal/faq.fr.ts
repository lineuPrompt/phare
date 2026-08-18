import type { LegalDocument } from './types';

/** Section ids MUST match faq.en.ts exactly — asserted by legalContent.test.ts. */
const faqFr: LegalDocument = {
  title: 'Questions fréquentes',
  lastUpdated: '2026-08-03',
  sections: [
    {
      id: 'what-is-phare',
      heading: 'Phare, c’est quoi au juste?',
      body: [
        'Phare est un système de planification financière pour les ménages. Vous lui indiquez vos revenus, vos factures, vos cartes et vos objectifs, et il tient à jour le portrait de votre argent — ce qui est entré, ce qui sort, ce qui s’en vient et si le plan tient la route.',
        'Ce n’est pas une application bancaire et il ne se connecte pas à votre banque. Tout ce qui s’y trouve y est parce que quelqu’un de votre ménage l’y a mis. C’est voulu : Phare s’accorde à votre façon de faire le suivi, et vos identifiants bancaires ne sont jamais en jeu.',
      ],
    },
    {
      id: 'ai-and-my-numbers',
      heading: 'Est-ce que Phare me donne des conseils financiers?',
      body: [
        'Non. Phare est un outil qui fait des calculs sur vos chiffres et explique le résultat en langage clair. Une partie de cette explication est rédigée par une IA, qui peut se tromper.',
        'Personne chez Phare n’est conseiller financier, comptable ou fiscaliste. Pour une décision qui compte — une hypothèque, une cotisation REER, une consolidation de dettes — parlez à un professionnel qualifié qui connaît l’ensemble de votre situation.',
      ],
    },
    {
      id: 'statement-close-day',
      heading: 'Pourquoi mon achat apparaît-il dans l’onglet du mois suivant?',
      body: [
        'Parce que les cartes de crédit facturent selon un cycle de relevé, pas selon le mois civil.',
        'Votre carte a un **jour de fermeture de relevé** — disons le 27. Tout ce que vous portez à la carte à partir du 28 appartient au prochain relevé, que vous paierez le mois suivant. Un achat du 28 juillet apparaît donc sous août, parce que c’est sur ce relevé qu’il tombera.',
        'La page Cartes de crédit affiche le cycle en cours dans le haut : la période visée et la date de paiement. Si un achat semble dans le mauvais mois, regardez cette ligne — le cycle en est presque toujours la raison.',
        'Vous définissez le jour de fermeture et le jour de paiement à la configuration de la carte, et vous pouvez les modifier depuis l’éditeur d’enveloppe.',
      ],
    },
    {
      id: 'three-payments',
      heading: 'Pourquoi mon hypothèque affiche-t-elle trois paiements ce mois-ci?',
      body: [
        'Parce qu’il y en a réellement trois ce mois-ci.',
        'Si vous payez aux deux semaines, certains mois comptent trois dates de paiement plutôt que deux. C’est vrai aussi d’une paie aux deux semaines — quatre mois par année, vous en recevez trois.',
        'Phare affiche des mois réels, jamais une moyenne. Une hypothèque de 1 500 $ aux deux semaines représente 3 000 $ la plupart des mois et 4 500 $ dans un mois à trois paiements, et Phare affiche 4 500 $, parce que c’est ce qui sortira de votre compte. Lisser à 3 250 $ rendrait chaque mois faux, dans un sens ou dans l’autre.',
        'La même logique s’applique aux revenus. Un mois à trois paies, c’est de l’argent réellement en plus, et votre bilan mensuel le nommera comme un événement ponctuel plutôt que de le traiter discrètement comme votre nouvelle normalité.',
      ],
    },
    {
      id: 'reserve-fund',
      heading: 'Qu’est-ce qu’un fonds de réserve?',
      body: [
        'C’est de l’argent mis de côté maintenant pour une facture que vous savez à venir.',
        'Taxes municipales, immatriculation, renouvellements d’assurance, le solde d’impôt à payer chaque avril — ce ne sont pas des urgences. Vous savez qu’elles s’en viennent et à peu près ce qu’elles coûtent. Si elles font mal, c’est qu’elles arrivent d’un coup sans compte prêt à les recevoir, et qu’elles atterrissent sur une marge de crédit.',
        'Un fonds de réserve règle cela en transformant une facture annuelle de 3 000 $ en 250 $ par mois. Phare suit ce que chaque provision coûte mensuellement, quand elle est due et où elle en est.',
        'Une précision : le fonds de réserve est **un seul compte partagé**, pas un compte par facture. Phare affiche le solde total et la provision mensuelle totale, pas un solde distinct par élément.',
      ],
    },
    {
      id: 'fixing-entries',
      heading: 'J’ai saisi quelque chose d’incorrect. Comment corriger?',
      body: [
        'Trouvez l’entrée et cliquez sur **Modifier**. Vous pouvez changer la date, la description, le montant et la catégorie, depuis l’Échéancier ou depuis la page Cartes de crédit.',
        'Pour la retirer complètement, cliquez sur **Supprimer**. C’est le bon geste pour un doublon ou pour quelque chose qui n’a jamais eu lieu — mais ne supprimez pas une dépense réelle simplement parce que vous préféreriez ne pas la voir. Le plan ne vaut que ce qu’on y met.',
        'Une chose à noter : **les paiements de carte calculés par l’application ne sont pas modifiables.** Ils découlent des achats réels portés à la carte et se mettent à jour d’eux-mêmes. Si l’un d’eux semble erroné, c’est l’achat derrière qu’il faut corriger.',
      ],
    },
    {
      id: 'review-timing',
      heading: 'Quand mon bilan mensuel paraît-il?',
      body: [
        'Au début de chaque mois, portant sur le mois qui vient de se terminer.',
        'Il se lit comme une courte lettre, pas comme un rapport — ce qui va bien, ce qu’il faut surveiller, et une chose à faire ce mois-ci. Il est bâti à partir de votre registre, donc ses chiffres concordent toujours avec le reste de l’application.',
        'Vous pouvez le régénérer en tout temps depuis le tableau de bord si vous avez corrigé des entrées et voulez qu’il en tienne compte.',
      ],
    },
    {
      id: 'projections',
      heading: 'Peut-on se fier à la projection?',
      body: [
        'C’est une estimation bâtie à partir de ce qui est déjà prévu, et elle est franche sur ce qui est connu et ce qui ne l’est pas.',
        'Pour une carte dont le relevé est déjà fermé, la projection utilise le montant réel que vous devez. Pour un cycle encore ouvert, elle utilise votre budget de carte, puisque personne ne connaît encore le total final. Chaque mois indique lequel a servi.',
        'Un mois rapproché est donc assez solide; un mois dans six mois suppose que tout se déroule comme prévu. C’est un plan, pas une prédiction.',
      ],
    },
    {
      id: 'who-can-see-my-household',
      heading: 'Qui d’autre voit mon ménage?',
      body: [
        'Toutes les personnes du ménage voient tout. Chaque transaction, chaque compte, chaque objectif, chaque bilan, peu importe qui les a saisis ou à qui appartient le revenu.',
        'Il n’y a pas d’espace privé à l’intérieur d’un ménage : tout y est partagé, par conception. N’invitez quelqu’un que si c’est ce que vous souhaitez.',
        'Un ménage compte au maximum deux personnes avec un identifiant. Vous pouvez aussi nommer d’autres personnes — vos enfants, par exemple — pour leur attribuer des dépenses, sans leur créer de compte.',
      ],
    },
    {
      id: 'data-location',
      heading: 'Où mes données sont-elles conservées?',
      body: [
        'Au Canada. Plus précisément dans la région AWS Canada Central, à Montréal, chez notre fournisseur de base de données Supabase.',
        'Une exception à connaître : lorsque Phare génère votre plan ou votre bilan mensuel, un sommaire des finances de votre ménage est transmis à Claude d’Anthropic, aux États-Unis, pour en rédiger le texte. La transmission est chiffrée et les renseignements ne servent pas à entraîner leurs modèles, mais ils sortent du pays. La politique de confidentialité précise exactement ce qui est transmis.',
      ],
    },
    {
      id: 'export-my-data',
      heading: 'Puis-je récupérer mes données?',
      body: [
        'Oui, depuis la page **Ménage**. **Exporter** télécharge toutes les transactions de votre ménage dans un fichier CSV, ouvrable dans Excel ou Google Sheets.',
      ],
    },
    {
      id: 'delete-my-account',
      heading: 'Puis-je supprimer mon compte?',
      body: [
        'Oui, depuis la même page **Ménage**. **Supprimer** efface votre compte définitivement. Il n’y a ni annulation ni délai de grâce : exportez d’abord si vous voulez une copie.',
        'Ce qui est retiré exactement dépend de s’il reste quelqu’un dans votre ménage — la politique de confidentialité décrit les deux cas.',
      ],
    },
    {
      id: 'contact',
      heading: 'Quelque chose cloche, ou je suis bloqué',
      body: [
        'Écrivez à **support@phare.money**. Une vraie personne le lit.',
        'S’il s’agit d’un chiffre qui semble erroné, dites-nous ce que vous avez vu et où — c’est habituellement suffisant pour le retrouver.',
      ],
    },
  ],
};

export default faqFr;
