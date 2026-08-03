import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

/** Section ids MUST match terms.en.ts exactly — asserted by legalContent.test.ts. */
const termsFr: LegalDocument = {
  title: 'Conditions d’utilisation',
  lastUpdated: '2026-08-03',
  intro: [
    P + 'Introduction — l’entente entre le ménage et Phare, en langage clair.',
  ],
  sections: [
    {
      id: 'acceptance',
      heading: 'Acceptation des conditions',
      body: [
        P + 'Utiliser Phare implique d’accepter les présentes conditions et la Politique de confidentialité. L’acceptation est consignée avec la version en vigueur.',
      ],
    },
    {
      id: 'not-financial-advice',
      heading: 'Phare n’est pas un conseiller financier',
      body: [
        P + 'LA SECTION LA PLUS IMPORTANTE. Phare produit des budgets, des projections et du coaching rédigé par IA dont le ton évoque un conseiller de confiance — ce ton est délibéré, ce qui rend cet avertissement plus nécessaire, pas moins.',
        P + 'Indiquer clairement : il ne s’agit pas de conseils financiers, fiscaux ou de placement réglementés; les projections sont des estimations; le ménage décide.',
      ],
    },
    {
      id: 'ai-limitations',
      heading: 'Ce que l’IA fait et ne fait pas',
      body: [
        P + 'Tous les calculs sont effectués par le code; l’IA se limite au classement et à la rédaction. Elle n’invente jamais un montant, un objectif ni un fonds de réserve.',
        P + 'Indiquer aussi les limites : le texte généré peut être erroné et ne doit pas être utilisé seul.',
      ],
    },
    {
      id: 'eligibility',
      heading: 'Qui peut utiliser Phare',
      body: [
        P + 'Majorité, résidence canadienne le cas échéant, un seul ménage par compte.',
      ],
    },
    {
      id: 'accounts-and-households',
      heading: 'Comptes et ménages',
      body: [
        P + 'Un ménage compte au plus deux membres avec accès. Chaque membre voit l’ensemble du portrait financier — cette visibilité partagée est voulue et ne doit surprendre personne.',
      ],
    },
    {
      id: 'your-data',
      heading: 'Vos renseignements',
      body: [
        P + 'Le ménage demeure propriétaire de ce qu’il saisit. Renvoyer à la Politique de confidentialité.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Utilisation acceptable',
      body: [
        P + 'Ne pas partager ses identifiants, ne pas extraire les données, ne pas tenter d’accéder au ménage d’autrui, ne pas revendre.',
      ],
    },
    {
      id: 'billing',
      heading: 'Essai, abonnement et facturation',
      body: [
        P + 'À CONFIRMER AVANT PUBLICATION : le schéma prévoit subscription_status et un identifiant client Stripe, mais aucune facturation n’est implémentée. Ne pas décrire des frais impossibles.',
      ],
    },
    {
      id: 'deletion',
      heading: 'Mettre fin à votre compte',
      body: [
        P + 'Deux avenues : un membre supprime son compte et le ménage subsiste, ou le ménage est supprimé entièrement. Immédiat, sans annulation ni délai de grâce — le produit l’affiche à l’écran, les conditions doivent concorder.',
      ],
    },
    {
      id: 'availability',
      heading: 'Disponibilité et modifications du service',
      body: [
        P + 'Aucune garantie de disponibilité; les fonctionnalités peuvent changer; préavis en cas de changement important.',
      ],
    },
    {
      id: 'liability',
      heading: 'Limitation de responsabilité',
      body: [
        P + 'Limitation rédigée en tenant compte de la Loi sur la protection du consommateur du Québec — certaines exclusions y sont inopposables.',
      ],
    },
    {
      id: 'governing-law',
      heading: 'Droit applicable',
      body: [
        P + 'Le droit du Québec et les tribunaux du district judiciaire.',
      ],
    },
    {
      id: 'changes',
      heading: 'Modifications des conditions',
      body: [
        P + 'Une révision importante exige une nouvelle acceptation avant de continuer à utiliser Phare.',
      ],
    },
    {
      id: 'contact',
      heading: 'Nous joindre',
      body: [P + 'support@phare.money'],
    },
  ],
};

export default termsFr;
