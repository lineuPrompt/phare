import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';

/**
 * Everything a signed-out person can do, in place inside AuthGate: sign in,
 * create an account, reset a password. In place, not routes, for AuthGate's
 * own reason: no redirect to race when the session appears.
 */
export default function SignedOutFlow() {
  const [screen, setScreen] = useState<'signIn' | 'signUp' | 'reset'>('signIn');

  // Android's Back returns to Sign in rather than closing the app (these
  // screens are not routes, so the router has nothing to go back to).
  useEffect(() => {
    if (screen === 'signIn') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('signIn');
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  if (screen === 'signUp') return <SignUpScreen onBack={() => setScreen('signIn')} />;
  if (screen === 'reset') return <ResetPasswordScreen onBack={() => setScreen('signIn')} />;
  return <SignInScreen onCreateAccount={() => setScreen('signUp')} onForgot={() => setScreen('reset')} />;
}
