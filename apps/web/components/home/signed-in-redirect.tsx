'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '../../lib/api';

/**
 * The homepage is public; someone already signed in goes on to their workspace (the role guard there picks the
 * right landing page). The session cookies are scoped to /api, so the server cannot tell on its own.
 */
export function SignedInRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    api('GET', '/me')
      .then(() => !cancelled && router.replace('/dashboard'))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
