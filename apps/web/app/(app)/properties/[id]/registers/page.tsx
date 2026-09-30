'use client';

import { useParams } from 'next/navigation';
import { RegistersScreen } from '../../../../../components/register/registers';
import { Require } from '../../../../../components/require';

/** Staff and Owner/Manager (`booking:read`). What each sees is decided by the API. */
export default function RegistersPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Require capability="booking:read">
      <RegistersScreen propertyId={id} />
    </Require>
  );
}
