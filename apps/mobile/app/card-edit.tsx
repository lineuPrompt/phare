import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import CardPlanEditScreen from '../src/screens/CardPlanEditScreen';

/**
 * /card-edit?cardId=…&month=YYYY-MM — edit a card's plan for one month, as a
 * modal over the card. Outside the (tabs) group, so it carries the same two
 * gates itself.
 */
export default function CardEdit() {
  return (
    <AuthGate>
      <HouseholdGate>
        <CardPlanEditScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
