'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

interface Session {
  me: Me;
  can: (capability: string) => boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/** Loads /me for the signed-in area. No session → login page, remembering where the user was going. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Me>('GET', '/me')
      .then((data) => !cancelled && setMe(data))
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    router.replace('/login');
  }, [router]);

  if (!me) return <>{fallback}</>;
  return <SessionContext.Provider value={{ me, can: (c) => me.capabilities.includes(c), logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
