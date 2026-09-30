'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { NotificationPrefs } from './types';

/**
 * Whether the API can send a given kind of message by WhatsApp (the switch is on and its template is approved).
 * `null` while it is being asked, `false` when it cannot (or the answer failed): the screen then keeps its manual way.
 */
export function useWhatsappReady(kind: 'checkinLink' | 'shareLink', active: boolean): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setReady(null);
    api<NotificationPrefs>('GET', '/me/notification-preferences')
      .then((p) => !cancelled && setReady(p.whatsapp[kind]))
      .catch(() => !cancelled && setReady(false));
    return () => {
      cancelled = true;
    };
  }, [kind, active]);
  return ready;
}
