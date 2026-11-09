'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PropertyHeader } from '../../../../components/property/property-header';
import { api } from '../../../../lib/api';
import type { PropertyFull, PropertyReduced } from '../../../../lib/types';

/**
 * Every screen of one property shares its header and section tabs. A role that may not read the property gets no
 * header (the API refuses, the page's own guard redirects).
 */
export default function PropertyLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<PropertyReduced | PropertyFull | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PropertyReduced | PropertyFull>('GET', `/properties/${id}`)
      .then((p) => !cancelled && setProperty(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-6">
      {property && <PropertyHeader property={property} />}
      {children}
    </div>
  );
}
