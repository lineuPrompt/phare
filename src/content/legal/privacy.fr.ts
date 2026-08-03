import type { LegalDocument } from './types';
import { PLACEHOLDER as P } from './types';

/** Section ids MUST match privacy.en.ts exactly — asserted by legalContent.test.ts. */
const privacyFr: LegalDocument = {
  title: 'Politique de confidentialité',
  lastUpdated: '2026-08-03',
  intro: [
    P + 'Introduction — qui exploite Phare, ce que couvre ce document, et l’engagement en langage clair.',
  ],
  sections: [
    {
      id: 'what-we-collect',
      heading: 'Les renseignements que nous recueillons',
      body: [
        P + 'Renseignements de compte (nom, courriel), composition du ménage, et chaque montant saisi ou importé — revenus, dépenses, comptes, soldes, objectifs, fonds de réserve.',
        P + 'NOTE DE RÉDACTION : les adresses IP sont traitées de façon transitoire par les limiteurs de débit des routes d’intégration non authentifiées. Éphémères et en mémoire, mais il s’agit tout de même de renseignements personnels.',
      ],
    },
    {
      id: 'uploaded-files',
      heading: 'Les fichiers que vous téléversez',
      body: [
        P + 'Le chiffrier d’intégration est analysé en mémoire et n’est jamais écrit dans le stockage — file_imports consigne qu’une importation a eu lieu, pas le fichier lui-même.',
      ],
    },
    {
      id: 'ai-processing',
      heading: 'Utilisation de vos renseignements par l’IA',
      body: [
        P + 'Les données financières du ménage sont transmises à Anthropic pour générer le plan, le bilan mensuel et la recommandation principale.',
        P + 'Préciser ce qui est transmis, ce qui ne l’est pas, et que l’IA n’invente ni ne modifie jamais les chiffres — le code est responsable des calculs.',
      ],
    },
    {
      id: 'sub-processors',
      heading: 'Fournisseurs de services',
      body: [
        P + 'Supabase (base de données, authentification), Vercel (hébergement), Anthropic (IA), Brevo (courriels transactionnels).',
      ],
    },
    {
      id: 'data-location',
      heading: 'Où vos renseignements sont conservés',
      body: [
        P + 'À CONFIRMER AVANT PUBLICATION : la région du projet Supabase, et le fait que le traitement par IA a lieu hors du Canada. La Loi 25 exige une évaluation des facteurs relatifs à la vie privée pour toute communication hors Québec.',
      ],
    },
    {
      id: 'activity-data',
      heading: 'Données d’utilisation',
      body: [
        P + 'Phare consigne des événements produit (intégration terminée, chronologie consultée, bilan mensuel consulté). Ces données appartiennent au ménage et SURVIVENT à la suppression du compte d’un membre.',
      ],
    },
    {
      id: 'retention-member-deletion',
      heading: 'Lorsqu’un membre supprime son compte',
      body: [
        P + 'L’accès est détruit et le nom est remplacé, mais le ménage conserve les données financières saisies par ce membre, car elles appartiennent au ménage.',
        P + 'À INDIQUER OBLIGATOIREMENT : un enregistrement de la demande de suppression conserve l’adresse courriel du membre à des fins de vérification. Ne pas affirmer que la suppression efface tout.',
      ],
    },
    {
      id: 'retention-household-deletion',
      heading: 'Lorsque le ménage est supprimé',
      body: [
        P + 'Supprimer le ménage détruit tout en cascade, y compris les enregistrements de demande de suppression et les courriels qu’ils contiennent.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Vos droits',
      body: [
        P + 'Accès, rectification, suppression, portabilité. La portabilité existe déjà — l’exportation CSV. Préciser le délai de réponse.',
      ],
    },
    {
      id: 'security',
      heading: 'Comment nous protégeons vos renseignements',
      body: [
        P + 'Chiffrement en transit et au repos, sécurité au niveau des lignes limitant chaque requête à un seul ménage, et plafond de membres.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Témoins (cookies)',
      body: [
        P + 'Uniquement des témoins de session d’authentification. Aucun témoin publicitaire ni d’analyse tierce.',
      ],
    },
    {
      id: 'changes',
      heading: 'Modifications de cette politique',
      body: [
        P + 'Comment les révisions sont publiées, et le fait qu’un changement important exige une nouvelle acceptation.',
      ],
    },
    {
      id: 'contact',
      heading: 'Nous joindre',
      body: [
        P + 'support@phare.money, ainsi que le responsable de la protection des renseignements personnels exigé par la Loi 25.',
      ],
    },
  ],
};

export default privacyFr;
