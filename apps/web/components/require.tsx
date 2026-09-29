'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useSession } from '../lib/session';

/** Sends users without the capability to their landing page. Convenience only: the API enforces access. */
export function Require({ capability, children }: { capability: string; children: ReactNode }) {
  const { can } = useSession();
  const router = useRouter();
  const allowed = can(capability);
  useEffect(() => {
    if (!allowed) router.replace(can('property:read') ? '/properties' : '/reports');
  }, [allowed, can, router]);
  return allowed ? <>{children}</> : null;
}
