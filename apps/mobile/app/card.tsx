import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import CardDetailScreen from '../src/screens/CardDetailScreen';

/**
 * /card?cardId=…&month=YYYY-MM — one card for one month, opened from the
 * Cards tab. Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function Card() {
  return (
    <AuthGate>
      <HouseholdGate>
        <CardDetailScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
