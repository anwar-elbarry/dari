'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api';
import { fetchSharedPdf } from '../../lib/share-api';
import { Alert, Button, buttonClass, Card } from '../ui';

type State = { step: 'loading' } | { step: 'ready'; url: string } | { step: 'unavailable' } | { step: 'temporary' };

const KEY_TOKEN = 'dari.share.token';
const store = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(KEY_TOKEN);
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      sessionStorage.setItem(KEY_TOKEN, v);
    } catch {
      /* ignore */
    }
  },
};

/**
 * The link carries its token in the URL fragment (`/s#token=…`), which no server, access log or link-preview bot
 * ever receives. It is read once, removed from the address bar, kept for this tab's session so a reload works,
 * and from then on travels only in a request header. A token in a query string is ignored on purpose.
 */
function readToken(): string | null {
  const found = /[#&]token=([A-Za-z0-9_-]{43})(?:&|$)/.exec(window.location.hash);
  if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname);
  if (found) {
    store.set(found[1]);
    return found[1];
  }
  return store.get();
}

/**
 * What an authority sees: a confidentiality notice and the one document, nothing else (no account, no navigation).
 * The PDF is fetched once per visit and held in this tab as an object URL, revoked when the page goes away.
 * A link that cannot be used, for whatever reason, shows one neutral page.
 */
export function SharedViewer() {
  const t = useTranslations('viewer');
  const [state, setState] = useState<State>({ step: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setState({ step: 'loading' });
    const token = readToken();
    if (!token) return setState({ step: 'unavailable' });
    try {
      setState({ step: 'ready', url: URL.createObjectURL(await fetchSharedPdf(token)) });
    } catch (e) {
      setState({ step: e instanceof ApiError && e.status === 404 ? 'unavailable' : 'temporary' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  useEffect(() => {
    if (state.step !== 'ready') return;
    const url = state.url;
    return () => URL.revokeObjectURL(url);
  }, [state]);

  if (state.step === 'loading') return <p className="text-sm text-slate">{t('loading')}</p>;

  if (state.step === 'unavailable') {
    return (
      <Card className="space-y-2">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('unavailableTitle')}</h1>
        <p className="text-sm text-slate">{t('unavailableBody')}</p>
      </Card>
    );
  }

  if (state.step === 'temporary') {
    return (
      <Card className="space-y-3">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('temporaryTitle')}</h1>
        <p className="text-sm text-slate">{t('temporaryBody')}</p>
        <Button onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</Button>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <Alert tone="warning">{t('notice')}</Alert>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Real links to the object URL: a tap is a user gesture, so the browser's own PDF viewer opens without a pop-up block. */}
        <a href={state.url} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
          {t('open')}
        </a>
        <a href={state.url} download="document.pdf" className={buttonClass('ghost')}>
          {t('download')}
        </a>
      </div>
      <iframe src={state.url} title={t('frameTitle')} className="h-[70dvh] w-full rounded-image border border-bone bg-card" />
      <p className="text-sm text-slate">{t('phoneHint')}</p>
    </section>
  );
}
