'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { Arrival, CheckinState, LinkStatus, PropertyReduced } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { DeliveryStatus } from '../delivery';
import { Alert, Button, Card, Dialog, StatusPill, Tag } from '../ui';
import { GuestDialog } from './guest-dialog';
import { LinkDialog } from './link-dialog';

const STATE_TONE: Record<CheckinState, 'neutral' | 'info' | 'warning' | 'success'> = { NONE: 'neutral', LINK_SENT: 'info', PARTIAL: 'warning', COMPLETE: 'success' };
const LINK_TONE: Record<LinkStatus, 'success' | 'neutral' | 'danger'> = { ACTIVE: 'success', EXPIRED: 'neutral', REVOKED: 'danger', COMPLETED: 'neutral' };
const WINDOWS = [30, 60, 120] as const;

export function ArrivalsScreen({ propertyId }: { propertyId: string }) {
  const t = useTranslations('checkin');
  const tp = useTranslations('property');
  const tc = useTranslations('common');
  const format = useFormatter();
  const { can } = useSession();
  const [property, setProperty] = useState<PropertyReduced | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[] | null>(null);
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(60);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ arrival: Arrival; mode: 'create' | 'resend' } | null>(null);
  const [revokeFor, setRevokeFor] = useState<Arrival | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const revoke = useSubmit();

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api<PropertyReduced>('GET', `/properties/${propertyId}`), api<Arrival[]>('GET', `/properties/${propertyId}/arrivals?days=${days}`)]);
      setProperty(p);
      setArrivals(a);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [propertyId, days]);
  useEffect(() => {
    void load();
  }, [load]);

  const day = (iso: string) => new Date(iso.slice(0, 10));
  const fmt = (iso: string) => format.dateTime(day(iso), { dateStyle: 'medium', timeZone: 'UTC' });
  const nights = (a: Arrival) => Math.max(1, Math.round((day(a.checkOut).getTime() - day(a.checkIn).getTime()) / 86_400_000));
  const canSend = can('checkin:manage');
  const managerView = can('police:read');

  async function confirmRevoke() {
    if (!revokeFor?.link) return;
    const link = revokeFor.link;
    if (await revoke.run(() => api('DELETE', `/checkin-links/${link.id}`).then(() => true))) {
      setRevokeFor(null);
      setNotice(t('revoked'));
      await load();
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={`/properties/${propertyId}`} className="text-sm font-medium text-link hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-slate">{property ? `${property.name} · ` : ''}{t('intro')}</p>
        {!managerView && <Alert tone="info">{t('staffNote')}</Alert>}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {failed && <Alert>{t('loadFailed')}</Alert>}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('window', { days })}>
        {WINDOWS.map((w) => (
          <Tag key={w} active={days === w} onClick={() => setDays(w)}>
            {t('window', { days: w })}
          </Tag>
        ))}
      </div>

      {arrivals && arrivals.length === 0 && <p className="text-sm text-slate">{t('empty')}</p>}

      <ul className="space-y-4">
        {arrivals?.map((a) => {
          const link = a.link;
          const total = link?.maxGuests ?? a.partySize ?? a.guests.length;
          return (
            <li key={a.bookingId}>
              <Card className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-semibold tabular-nums">
                      {fmt(a.checkIn)} → {fmt(a.checkOut)}
                    </p>
                    <p className="text-sm text-slate">
                      {tp(`source.${a.source}`)} · {t('nights', { count: nights(a) })}
                      {a.partySize ? ` · ${t('party', { count: a.partySize })}` : ''}
                    </p>
                  </div>
                  <StatusPill tone={STATE_TONE[a.checkinStatus]}>{t(`state.${a.checkinStatus}`, { done: a.guests.length, total })}</StatusPill>
                </div>

                {a.guests.length > 0 && (
                  <ul className="divide-y divide-bone rounded-card border border-bone">
                    {a.guests.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <p className="min-w-0 text-sm font-medium" dir="auto">
                          {managerView && g.fullName ? g.fullName : t('guestLabel', { n: g.guestIndex ?? 1 })}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={g.status === 'VERIFIED' ? 'success' : 'info'}>{t(`guestStatus.${g.status}`)}</StatusPill>
                          {g.hasFiche && <span className="text-xs text-slate">{t('ficheReady')}</span>}
                          {managerView && (
                            <Button variant="ghost" onClick={() => setGuestId(g.id)}>
                              {t('open')}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {link && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-slate">
                    <StatusPill tone={LINK_TONE[link.status]}>{t(`linkStatus.${link.status}`, { date: fmt(link.expiresAt) })}</StatusPill>
                  </p>
                )}
                {link && canSend && <DeliveryStatus linkId={link.id} />}

                {canSend && a.checkinStatus !== 'COMPLETE' && (
                  <div className="flex flex-wrap gap-2 border-t border-bone pt-3">
                    {link?.status === 'ACTIVE' ? (
                      <>
                        <Button variant="ghost" onClick={() => setLinkFor({ arrival: a, mode: 'resend' })}>
                          {t('resend')}
                        </Button>
                        <Button variant="danger" onClick={() => setRevokeFor(a)}>
                          {t('revoke')}
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => setLinkFor({ arrival: a, mode: 'create' })}>{link ? t('sendNewLink') : t('sendLink')}</Button>
                    )}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <LinkDialog arrival={linkFor?.arrival ?? null} mode={linkFor?.mode ?? 'create'} propertyName={property?.name ?? ''} onClose={() => setLinkFor(null)} onChanged={() => void load()} />

      <Dialog open={revokeFor !== null} onClose={() => setRevokeFor(null)} title={t('revokeTitle')} closeLabel={tc('cancel')}>
        <div className="space-y-4">
          <p className="text-sm text-slate">{t('revokeBody')}</p>
          {revoke.error && <Alert>{revoke.error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="dark" onClick={confirmRevoke} disabled={revoke.pending}>
              {t('revokeConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setRevokeFor(null)}>
              {tc('cancel')}
            </Button>
          </div>
        </div>
      </Dialog>

      <GuestDialog guestId={guestId} onClose={() => setGuestId(null)} onChanged={() => void load()} />
    </section>
  );
}
