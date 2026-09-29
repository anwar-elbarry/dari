'use client';

import { useEffect } from 'react';

/** Removes ?token= from the address bar once read, so it does not stay in history or get shared by accident. */
export function useStripTokenFromUrl() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);
}
