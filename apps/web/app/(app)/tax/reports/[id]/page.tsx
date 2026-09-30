'use client';

import { useParams } from 'next/navigation';
import { Require } from '../../../../../components/require';
import { ReportDetailScreen } from '../../../../../components/tax/report-detail';

/** One tax estimate: Owner/Manager and Accountant (`report:read`). Staff are sent back to their landing page. */
export default function TaxReportPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Require capability="report:read">
      <ReportDetailScreen reportId={id} />
    </Require>
  );
}
