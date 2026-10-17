// On-sale watcher: periodically re-checks watched events (sequentially, through
// each provider's throttled client) and raises alerts on status changes and
// price drops.

const STATUS_LABELS = {
  onsale: 'On sale now',
  scheduled: 'Sale scheduled',
  offsale: 'Off sale',
  soldout: 'Sold out',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  rescheduled: 'Rescheduled',
  unknown: 'Status unknown',
};

export const statusLabel = (status) => STATUS_LABELS[status] ?? status;

/**
 * Compare the stored watch item with a fresh event.
 * @returns {{type: 'status'|'price_drop', title: string, message: string}[]}
 */
export function diffEvent(previous, next, { formatMoney = defaultFormatMoney } = {}) {
  const changes = [];
  const from = previous.lastStatus;
  const to = next.onSale?.status ?? 'unknown';
  if (from && to !== from && to !== 'unknown') {
    changes.push({
      type: 'status',
      title: `${statusLabel(to)}: ${next.name}`,
      message: `Status changed from "${statusLabel(from)}" to "${statusLabel(to)}".`,
    });
  }

  const before = previous.lastTotalMinor;
  const after = next.price?.totalMinor;
  if (before != null && after != null && after < before && previous.lastCurrency === next.price.currency) {
    changes.push({
      type: 'price_drop',
      title: `Price drop: ${next.name}`,
      message: `Cheapest total for ${next.price.qty} fell from ${formatMoney(before, next.price.currency)} to ${formatMoney(after, next.price.currency)}.`,
    });
  }
  return changes;
}

function defaultFormatMoney(minor, currency) {
  const digits = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const amount = minor / 10 ** digits;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency, maximumFractionDigits: Number.isInteger(amount) ? 0 : digits,
  }).format(amount);
}

export function createWatcher({ store, registry, notify = async () => {}, onAlert = () => {}, onItem = () => {}, intervalMs }) {
  let timer = null;
  let running = null;

  async function checkOne(item) {
    const provider = registry.get(item.source);
    if (!provider || !provider.isConfigured()) {
      return store.watchlist.recordError(item.eventId, `Provider "${item.source}" is not available.`);
    }
    let event;
    try {
      event = await provider.getEvent(item.sourceEventId, { qty: item.qty });
    } catch (err) {
      const updated = store.watchlist.recordError(item.eventId, err.expose ? err.message : 'Check failed.');
      onItem(updated);
      return updated;
    }

    for (const change of diffEvent(item, event)) {
      const alert = store.alerts.add({ eventId: item.eventId, url: event.url, ...change });
      onAlert(alert);
      notify(alert).catch((err) => console.warn('[watcher] notification failed:', err.message));
    }
    const updated = store.watchlist.recordCheck(item.eventId, event);
    onItem(updated);
    return updated;
  }

  async function checkAll() {
    if (running) return running; // never overlap runs
    running = (async () => {
      for (const item of store.watchlist.list()) {
        await checkOne(item);
      }
    })().finally(() => { running = null; });
    return running;
  }

  return {
    checkOne,
    checkAll,
    start() {
      if (timer) return;
      timer = setInterval(() => checkAll().catch((err) => console.warn('[watcher]', err.message)), intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
