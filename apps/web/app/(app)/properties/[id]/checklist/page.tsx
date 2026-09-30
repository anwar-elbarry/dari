'use client';

import { useParams } from 'next/navigation';
import { ChecklistScreen } from '../../../../../components/checklist/checklist-screen';
import { Require } from '../../../../../components/require';

/** Staff (status only) and Owner/Manager (`checklist:read`). What each sees is decided by the API. */
export default function ChecklistPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Require capability="checklist:read">
      <ChecklistScreen propertyId={id} />
    </Require>
  );
}
