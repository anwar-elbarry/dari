'use client';

import { Require } from '../../../components/require';
import { NotificationsScreen } from '../../../components/settings/notifications-screen';

/** Owners and managers receive the alerts, so they choose how (`team:manage`). */
export default function NotificationsPage() {
  return (
    <Require capability="team:manage">
      <NotificationsScreen />
    </Require>
  );
}
