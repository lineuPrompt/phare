import ReviewScreen from '../../src/screens/ReviewScreen';

/**
 * The home route: the monthly review. The auth gate wraps the whole tab
 * navigator (src/components/TabsLayout.tsx), so this route and its siblings
 * cannot render signed out, including when reached by a deep link.
 */
export default function Index() {
  return <ReviewScreen />;
}
