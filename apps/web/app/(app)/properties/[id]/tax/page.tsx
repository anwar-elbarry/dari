'use client';

import { useParams } from 'next/navigation';
import { Require } from '../../../../../components/require';
import { TaxScreen } from '../../../../../components/tax/tax-screen';

/** Owner/Manager only (`report:generate`); the API refuses everyone else, the Accountant included. */
export default function PropertyTaxPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Require capability="report:generate">
      <TaxScreen propertyId={id} />
    </Require>
  );
}
