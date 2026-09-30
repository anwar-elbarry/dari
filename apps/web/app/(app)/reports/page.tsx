'use client';

import { Require } from '../../../components/require';
import { ReportsList } from '../../../components/tax/reports-list';

/** Tax estimates of the account: home of the Accountant and a list for Owner/Manager (`report:read`). The API enforces access. */
export default function ReportsPage() {
  return (
    <Require capability="report:read">
      <ReportsList />
    </Require>
  );
}
