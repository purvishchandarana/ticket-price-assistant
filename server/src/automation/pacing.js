// Human-paced delays between automated actions (600–1800 ms by default).
// This keeps the assistant's request rate at roughly what a person does by
// hand. It is pacing, not disguise: the browser is your real, unmodified Chrome.

export class AbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortedError';
  }
}

export function randomDelayMs(min = 600, max = 1800, random = Math.random) {
  return Math.round(min + random() * (max - min));
}

/** Sleep that rejects with AbortedError as soon as `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function humanDelay({ min = 600, max = 1800, signal } = {}) {
  return sleep(randomDelayMs(min, max), signal);
}
