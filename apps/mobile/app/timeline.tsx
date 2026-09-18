import AuthGate from '../src/components/AuthGate';
import TimelineScreen from '../src/screens/TimelineScreen';

/** /timeline — the cash timeline, behind the same gate as the index. */
export default function Timeline() {
  return (
    <AuthGate>
      <TimelineScreen />
    </AuthGate>
  );
}
