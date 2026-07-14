// FR display names for the 10 seeded expense categories. Seed rows may or
// may not have categories.name_fr populated in the live DB (the seeding
// trigger lives in Supabase, not in this repo — see punch list item 1); this
// map is the fallback so FR users see French names either way. User-created
// categories are never in this map and display exactly as entered.
const SEED_NAME_FR: Record<string, string> = {
  'Housing': 'Logement',
  'Transportation': 'Transport',
  'Restaurants': 'Restaurants',
  'Groceries & Pharmacy': 'Épicerie et pharmacie',
  'Utilities & Subscriptions': 'Services publics et abonnements',
  'Childcare': 'Garde d’enfants',
  'Shopping': 'Magasinage',
  'Health & Personal': 'Santé et soins personnels',
  'Installments': 'Paiements échelonnés',
  'Unexpected': 'Imprévus',
};

export function categoryDisplayName(
  category: { name: string; name_fr?: string | null },
  locale: string
): string {
  if (locale !== 'fr') return category.name;
  if (category.name_fr && category.name_fr.trim()) return category.name_fr;
  return SEED_NAME_FR[category.name] ?? category.name;
}
