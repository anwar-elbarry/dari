'use client';

import { useParams } from 'next/navigation';
import { ArrivalsScreen } from '../../../../../components/checkin/arrivals';
import { Require } from '../../../../../components/require';

/** Staff and Owner/Manager (`booking:read`). What each sees is decided by the API. */
export default function ArrivalsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Require capability="booking:read">
      <ArrivalsScreen propertyId={id} />
    </Require>
  );
}
