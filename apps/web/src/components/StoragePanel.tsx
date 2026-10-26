import type { CardDBMeta } from '@mtg/schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUDGET_CHOICES,
  clearImageCache,
  formatBytes,
  imageCacheStats,
  imageCacheSupported,
  setImageBudget,
  type ImageCacheStats,
} from '../imageCache';

export function StoragePanel({ open, onClose, meta }: { open: boolean; onClose: () => void; meta: CardDBMeta | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [stats, setStats] = useState<ImageCacheStats | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = imageCacheSupported();

  const refresh = useCallback(async () => {
    setStats(await imageCacheStats());
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      setQuota({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
    }
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void refresh();
    } else if (!open && dialog.open) dialog.close();
  }, [open, refresh]);

  const change = async (bytes: number) => {
    setBusy(true);
    setStats(await setImageBudget(bytes));
    setBusy(false);
  };

  const clear = async () => {
    setBusy(true);
    setStats(await clearImageCache());
    await refresh();
    setBusy(false);
  };

  const used = stats ? Math.min(1, stats.bytes / stats.budget) : 0;

  return (
    <dialog ref={ref} className="storage" onClose={onClose} aria-labelledby="storage-title">
      <form method="dialog" className="storage-inner">
        <header>
          <h2 id="storage-title">Storage</h2>
          <button type="submit" className="ghost">
            Done
          </button>
        </header>

        <section>
          <h3>Card images</h3>
          {!supported && (
            <p className="muted">
              Image caching needs a secure connection (https or localhost). Images still load; the browser’s normal cache
              handles them.
            </p>
          )}
          {supported && !stats && <p className="muted">The image cache starts after the first reload.</p>}
          {stats && (
            <>
              <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={stats.budget} aria-valuenow={stats.bytes}>
                <div className="meter-fill" style={{ width: `${used * 100}%` }} />
              </div>
              <p className="meter-text">
                <strong>{formatBytes(stats.bytes)}</strong> of {formatBytes(stats.budget)} used by {stats.count.toLocaleString()} images.
                Least recently viewed images are removed first.
              </p>
              <fieldset className="budget" disabled={busy}>
                <legend>Keep up to</legend>
                {BUDGET_CHOICES.map((b) => (
                  <label key={b} className={stats.budget === b ? 'seg active' : 'seg'}>
                    <input type="radio" name="budget" checked={stats.budget === b} onChange={() => void change(b)} />
                    {formatBytes(b)}
                  </label>
                ))}
              </fieldset>
              <button type="button" className="secondary" onClick={() => void clear()} disabled={busy || stats.count === 0}>
                Clear image cache
              </button>
            </>
          )}
        </section>

        <section>
          <h3>Card data</h3>
          {meta ? (
            <p>
              {meta.cardCount.toLocaleString()} cards, {formatBytes(meta.bytes)} compressed. Built{' '}
              {new Date(meta.builtAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              {meta.sourceUpdatedAt ? ` from Scryfall data of ${new Date(meta.sourceUpdatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ' from the sample set'}.
            </p>
          ) : (
            <p className="muted">Not loaded.</p>
          )}
        </section>

        {quota && quota.quota > 0 && (
          <section>
            <h3>This site in your browser</h3>
            <p>
              {formatBytes(quota.usage)} used. The browser allows up to {formatBytes(quota.quota)}.
            </p>
          </section>
        )}
      </form>
    </dialog>
  );
}
