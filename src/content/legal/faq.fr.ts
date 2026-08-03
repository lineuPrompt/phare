import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

/** Section ids MUST match faq.en.ts exactly — asserted by legalContent.test.ts. */
const faqFr: LegalDocument = {
  title: 'Foire aux questions',
  lastUpdated: '2026-08-03',
  sections: [
    {
      id: 'what-is-phare',
      heading: 'Qu’est-ce que Phare?',
      body: [P + 'Un outil de budget et de coaching pour les familles canadiennes — ce qu’il fait, en deux phrases.'],
    },
    {
      id: 'is-my-data-safe',
      heading: 'Mes renseignements financiers sont-ils protégés?',
      body: [P + 'Réponse courte et lien vers la Politique de confidentialité. Ne pas répéter la politique ici.'],
    },
    {
      id: 'does-it-connect-to-my-bank',
      heading: 'Phare se connecte-t-il à ma banque?',
      body: [P + 'Non. Tout est saisi manuellement ou importé depuis le gabarit Phare. À répondre tôt — c’est la première question de la plupart des gens.'],
    },
    {
      id: 'ai-and-my-numbers',
      heading: 'L’IA voit-elle mes chiffres?',
      body: [P + 'Oui, et il faut le dire clairement. Puis expliquer la partie rassurante : l’IA rédige les mots, le code fait les calculs.'],
    },
    {
      id: 'who-can-see-my-household',
      heading: 'Qui d’autre peut voir mon ménage?',
      body: [P + 'Les deux membres voient tout. Établir cette attente avant d’inviter un conjoint, pas après.'],
    },
    {
      id: 'export-my-data',
      heading: 'Puis-je récupérer mes données?',
      body: [P + 'Oui — exportation CSV de toutes les transactions, à tout moment, depuis la page Ménage.'],
    },
    {
      id: 'delete-my-account',
      heading: 'Comment supprimer mon compte?',
      body: [P + 'Les deux cas, brièvement : quitter un ménage ou le supprimer. Immédiat, sans annulation.'],
    },
    {
      id: 'what-does-it-cost',
      heading: 'Combien coûte Phare?',
      body: [P + 'À CONFIRMER : aucune facturation n’est implémentée. Dire ce qui est vrai aujourd’hui.'],
    },
    {
      id: 'quebec-specific',
      heading: 'Phare tient-il compte des impôts et prestations du Québec?',
      body: [P + 'REER/REEE/CELI/SCEE et particularités québécoises — décrire ce que le coaching prend réellement en compte, sans exagérer.'],
    },
    {
      id: 'contact',
      heading: 'Comment obtenir de l’aide?',
      body: [P + 'support@phare.money'],
    },
  ],
};

export default faqFr;
