import PrivacyScreen from '../src/screens/PrivacyScreen';

/**
 * /terms — the Terms of Service, opened from sign-up's consent box and from
 * the updated-terms screen. Public on purpose (listed in the route tripwire):
 * it reads no household data, and a person must read the Terms before they
 * have an account.
 */
export default function Terms() {
  return <PrivacyScreen doc="terms" />;
}
