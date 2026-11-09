'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ImportFlow } from '../../../../../components/import/import-flow';
import { Require } from '../../../../../components/require';

export default function ImportPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('import');
  return (
    <Require capability="booking:write">
      <section className="space-y-5">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <ImportFlow propertyId={id} onDone={() => undefined} />
      </section>
    </Require>
  );
}
