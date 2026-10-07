import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignedInRedirect } from '../components/home/signed-in-redirect';
import { Icon, type IconName } from '../components/icons';
import { LocaleSwitch } from '../components/locale-switch';
import { Logo } from '../components/logo';
import { buttonClass } from '../components/button-class';
import { IconChip, Meta, StatusPill } from '../components/ui';
import { SUPPORT_EMAIL } from '../lib/contact';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home');
  return { title: t('metaTitle'), description: t('metaDescription') };
}

const contactHref = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : null;

/** Public homepage. Wording stays neutral: estimates are to confirm with an accountant, nothing claims compliance. */
export default async function Home() {
  const t = await getTranslations('home');
  const tc = await getTranslations('common');

  const nav = [
    { href: '#features', label: t('nav.features') },
    { href: '#how', label: t('nav.how') },
    { href: '#security', label: t('nav.security') },
    { href: '#faq', label: t('nav.faq') },
  ];

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <SignedInRedirect />

      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="rounded-card-lg border border-bone bg-gradient-to-b from-mist to-canvas">
          <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <Logo size={32} />
            <nav aria-label={t('nav.label')} className="hidden items-center gap-1 lg:flex">
              {nav.map((n) => (
                <a key={n.href} href={n.href} className="inline-flex min-h-11 items-center rounded-pill px-4 font-display text-sm font-semibold text-carbon no-underline hover:bg-mercury">
                  {n.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <div className="hidden sm:block">
                <LocaleSwitch />
              </div>
              <Link href="/login" className={buttonClass('ghost', 'bg-card')}>
                {t('nav.login')}
              </Link>
              {contactHref && (
                <a href={contactHref} className={buttonClass('dark', 'hidden sm:inline-flex')}>
                  {t('nav.contact')}
                </a>
              )}
            </div>
          </header>

          <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-16 lg:pb-20">
            <div className="space-y-6">
              <Meta>{t('hero.eyebrow')}</Meta>
              <h1 className="font-display text-4xl leading-[1.08] font-medium tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                {t('hero.title')} <strong className="font-bold">{t('hero.titleStrong')}</strong>
              </h1>
              <p className="max-w-xl text-lg text-slate">{t('hero.text')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <a href={contactHref ?? '/login'} className={buttonClass('dark')}>
                  {contactHref ? t('hero.cta') : t('nav.login')}
                  <Icon name="arrowRight" size={18} className="rtl:-scale-x-100" />
                </a>
                {contactHref && (
                  <Link href="/login" className={buttonClass('ghost', 'bg-card')}>
                    {t('nav.login')}
                  </Link>
                )}
              </div>
              <p className="text-sm text-slate">{t('hero.note')}</p>
              <div className="sm:hidden">
                <LocaleSwitch />
              </div>
            </div>
            <HeroPreview t={t} />
          </section>
        </div>
      </div>

      <main>
        <section id="features" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-20 sm:px-6">
          <SectionTitle eyebrow={t('features.eyebrow')} title={t('features.title')} />
          <ul className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            <Feature icon="calendar" title={t('features.nights.title')} text={t('features.nights.text')} />
            <Feature icon="clipboard" title={t('features.checkin.title')} text={t('features.checkin.text')} highlight />
            <Feature icon="report" title={t('features.tax.title')} text={t('features.tax.text')} badge={t('features.tax.badge')} />
          </ul>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-4 pb-20 sm:px-6">
          <SectionTitle eyebrow={t('how.eyebrow')} title={t('how.title')} />
          <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            {(['s1', 's2', 's3'] as const).map((s, i) => (
              <li key={s} className="flex flex-col gap-4 rounded-card-lg border border-bone bg-gradient-to-b from-card to-mist p-6">
                <span className="font-display text-5xl leading-none font-bold tracking-[-0.04em] text-link tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="font-display text-lg font-semibold tracking-[-0.02em]">{t(`how.${s}.title`)}</h3>
                <p className="text-sm text-slate">{t(`how.${s}.text`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="security" className="scroll-mt-6 bg-plaster">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <SectionTitle eyebrow={t('security.eyebrow')} title={t('security.title')} />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['encrypted', 'audited', 'retention', 'noAi', 'roles'] as const).map((k) => (
                <li key={k} className={`flex items-start gap-3 rounded-card border border-bone bg-card p-4 ${k === 'roles' ? 'sm:col-span-2' : ''}`}>
                  <IconChip tone="dark">
                    <Icon name={k === 'noAi' || k === 'encrypted' ? 'shield' : 'check'} size={18} />
                  </IconChip>
                  <p className="pt-2 text-sm text-carbon">{t(`security.${k}`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-6 px-4 py-20 sm:px-6">
          <SectionTitle eyebrow={t('faq.eyebrow')} title={t('faq.title')} center />
          <div className="mt-10 space-y-3">
            {(['1', '2', '3', '4'] as const).map((n) => (
              <details key={n} className="group rounded-card border border-bone bg-card px-5 open:shadow-sm">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 font-display text-base font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.q${n}`)}
                  <Icon name="plus" size={18} className="flex-none transition-transform duration-150 group-open:rotate-45" />
                </summary>
                <p className="pb-5 text-sm text-slate">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="relative overflow-hidden rounded-card-lg bg-primary px-6 py-14 text-center text-on-primary sm:px-10">
            <Rings />
            <div className="relative mx-auto max-w-2xl space-y-4">
              <h2 className="font-display text-3xl leading-[1.15] font-bold tracking-[-0.03em] sm:text-4xl">{t('cta.title')}</h2>
              <p className="text-base">{t('cta.text')}</p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                {contactHref && (
                  <a href={contactHref} className={buttonClass('dark')}>
                    <Icon name="mail" size={18} />
                    {t('nav.contact')}
                  </a>
                )}
                <Link href="/login" className={buttonClass('light')}>
                  {t('nav.login')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="space-y-1">
          <Logo size={26} />
          <p className="text-sm text-slate">{tc('tagline')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate">
          <Link href="/login" className="text-carbon hover:underline">
            {t('nav.login')}
          </Link>
          {contactHref && (
            <a href={contactHref} className="text-carbon hover:underline">
              {t('nav.contact')}
            </a>
          )}
          <span>{t('footer.rights', { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'home'>>>;

function SectionTitle({ eyebrow, title, center }: { eyebrow: string; title: string; center?: boolean }) {
  return (
    <div className={`space-y-3 ${center ? 'text-center' : ''}`}>
      <Meta>{eyebrow}</Meta>
      <h2 className="font-display text-3xl leading-[1.15] font-bold tracking-[-0.03em] sm:text-4xl">{title}</h2>
    </div>
  );
}

function Feature({ icon, title, text, badge, highlight }: { icon: IconName; title: string; text: string; badge?: string; highlight?: boolean }) {
  return (
    <li className={`flex flex-col gap-4 rounded-card-lg p-6 ${highlight ? 'bg-primary text-on-primary' : 'border border-bone bg-gradient-to-b from-card to-mist'}`}>
      <div className="flex items-center justify-between gap-3">
        <IconChip tone={highlight ? 'dark' : 'raised'}>
          <Icon name={icon} size={20} />
        </IconChip>
        {badge && <StatusPill tone="info">{badge}</StatusPill>}
      </div>
      <h3 className="font-display text-xl font-semibold tracking-[-0.02em]">{title}</h3>
      <p className={`text-sm ${highlight ? '' : 'text-slate'}`}>{text}</p>
    </li>
  );
}

/** Decorative rings (brand-deep on the lime fill). */
function Rings({ className = '-end-20 -bottom-24' }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 200 200" className={`pointer-events-none absolute size-72 text-brand-deep opacity-40 rtl:-scale-x-100 ${className}`}>
      <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round">
        <path d="M30 150a80 80 0 1 1 140 0" />
        <path d="M62 150a48 48 0 1 1 86-30" opacity="0.6" />
      </g>
    </svg>
  );
}

/** Product preview made of the app's own pieces, with sample data. One image for assistive tech. */
function HeroPreview({ t }: { t: T }) {
  const card = 'rounded-card-lg border border-bone bg-card shadow-[var(--shadow-lift)]';
  return (
    <div role="img" aria-label={t('illus.label')} className="relative flex flex-col gap-4 lg:block lg:h-[480px]">
      <div className={`relative overflow-hidden rounded-card-lg bg-primary p-6 text-on-primary shadow-[var(--shadow-lift)] lg:absolute lg:end-0 lg:top-0 lg:w-72`}>
        <Rings className="-end-24 -top-24" />
        <div className="relative">
          <p className="font-display text-sm font-semibold">{t('illus.nights')}</p>
          <p className="mt-2 font-display text-5xl leading-none font-bold tracking-[-0.035em] tabular-nums">
            64<small className="ms-2 text-lg font-semibold">{t('illus.unit')}</small>
          </p>
        </div>
      </div>

      <div className={`${card} lg:absolute lg:start-0 lg:top-36 lg:w-[22rem]`}>
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-5">
          <span className="inline-flex size-11 flex-none items-center justify-center rounded-card border border-bone bg-mist">
            <Icon name="riad" size={22} />
          </span>
          <div className="space-y-2">
            <p className="font-display text-lg leading-[1.35] font-bold tracking-[-0.02em]">{t('illus.property')}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusPill tone="warning">{t('illus.status')}</StatusPill>
              <Meta>{t('illus.type')}</Meta>
            </div>
          </div>
        </div>
        <div className="space-y-2 border-t border-bone px-6 pt-4 pb-5">
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.03em] tabular-nums">64</span>
            <span className="text-sm text-slate">{t('illus.unit')}</span>
          </p>
          <div className="h-1.5 overflow-hidden rounded-pill bg-mercury">
            <div className="h-full w-[53%] rounded-pill bg-ink" />
          </div>
          <p className="text-xs font-medium text-slate">{t('illus.rules')}</p>
        </div>
      </div>

      <div className={`${card} flex items-center gap-3 p-4 lg:absolute lg:end-4 lg:bottom-0 lg:w-80`}>
        <IconChip tone="dark">
          <Icon name="users" size={18} />
        </IconChip>
        <div className="min-w-0 space-y-1.5">
          <p className="font-display text-sm font-semibold">{t('illus.arrivals')}</p>
          <p className="text-sm text-slate">{t('illus.guests')}</p>
          <StatusPill tone="success">{t('illus.fiche')}</StatusPill>
        </div>
      </div>
    </div>
  );
}
