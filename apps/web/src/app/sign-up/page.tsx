'use client';

import { SignUpForm } from '../../ui/auth/SignUpForm';
import { useCore } from '../../ui/core/CoreProvider';
import { UnlockForm } from '../../ui/auth/UnlockForm';

export default function SignUpPage() {
  const { phase } = useCore();
  // An existing account on this device is unlocked, not recreated.
  if (phase === 'locked') return <UnlockForm />;
  return <SignUpForm />;
}
