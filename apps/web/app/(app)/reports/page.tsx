'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '../../../components/ui';

export default function ReportsPage() {
  const t = useTranslations('reports');
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
      <Alert tone="info">{t('comingSoon')}</Alert>
    </section>
  );
}
