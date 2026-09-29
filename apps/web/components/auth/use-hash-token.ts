'use client';

import { useEffect, useState } from 'react';

/**
 * Reads the single-use token from the URL fragment (#token=…). A fragment is never sent to the server,
 * so the token stays out of proxy and server logs. It is then removed from the address bar.
 * Returns undefined while reading, null when absent.
 */
export function useHashToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(value && /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  return token;
}
