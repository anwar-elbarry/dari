'use client';

import { Require } from '../../../components/require';
import { SharesScreen } from '../../../components/share/shares-screen';

/** Owner/Manager only (`share:manage`); the API refuses everyone else. */
export default function SharesPage() {
  return (
    <Require capability="share:manage">
      <SharesScreen />
    </Require>
  );
}
