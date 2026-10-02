import PrivacyScreen from '../src/screens/PrivacyScreen';

/**
 * /privacy — the Privacy Policy, opened from the Account tab. Public on
 * purpose (listed in the route tripwire): it reads no household data, and a
 * privacy policy must be readable by anyone, signed in or not.
 */
export default function Privacy() {
  return <PrivacyScreen />;
}
