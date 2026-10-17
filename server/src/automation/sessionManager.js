// Runs one booking-assist session at a time in the user's own Chrome.
//
//   starting → running ⇄ paused (challenge | user) → your_turn → at_payment
//                     ↘ stopped / error            (interrupted after a server restart)
//
// Hard rules enforced here:
//   - Pause on any CAPTCHA / queue / bot check; never interact with it.
//   - Resume automatically when the challenge is gone, or when the user clicks Continue.
//   - Seats are always chosen by the user (adapters stop before seat selection).
//   - On a payment page: stop all automation and the screencast immediately and
//     bring the tab to the front. Payment pages are never streamed or read.
//   - Only one active session at a time (no parallel sessions).

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { challengeDetected } from './challenge.js';
import { AbortedError, humanDelay, sleep } from './pacing.js';
import { startScreencast as defaultStartScreencast } from './screencast.js';

export const ACTIVE_STATUSES = new Set(['starting', 'running', 'paused', 'your_turn']);
const TERMINAL_STATUSES = new Set(['stopped', 'at_payment', 'error']);
const MAX_TIMELINE = 200;

export class SessionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SessionError';
    this.status = status;
    this.expose = true;
  }
}

class PaymentReached extends Error {}

export class SessionManager extends EventEmitter {
  #state = null;
  #runtime = null;

  /**
   * @param {object} deps
   * @param {{sessions: {save: Function, latest: Function}}} deps.store
   * @param {ReturnType<import('./browser.js').createBrowserConnector>} deps.browser
   * @param {(event: object) => object|null} deps.pickAdapter
   */
  constructor({
    store,
    browser,
    pickAdapter,
    detectChallenge = challengeDetected,
    startScreencast = defaultStartScreencast,
    delay = humanDelay,
    pollMs = 1500,
    now = () => new Date(),
  }) {
    super();
    this.store = store;
    this.browser = browser;
    this.pickAdapter = pickAdapter;
    this.detectChallenge = detectChallenge;
    this.startScreencast = startScreencast;
    this.delay = delay;
    this.pollMs = pollMs;
    this.now = now;
  }

  /** Load the last session; one that was active when the server stopped becomes "interrupted". */
  init() {
    const last = this.store.sessions.latest();
    if (last && ACTIVE_STATUSES.has(last.status)) {
      this.#state = last;
      this.#set({ status: 'interrupted', pauseReason: null, message: 'The server restarted. Click Continue to re-attach to your Chrome tab.' });
      this.#log('info', 'Session interrupted by a server restart.');
    } else {
      this.#state = last;
    }
  }

  current() {
    return this.#state ? structuredClone(this.#state) : null;
  }

  isActive() {
    return Boolean(this.#state && (ACTIVE_STATUSES.has(this.#state.status) || this.#state.status === 'interrupted'));
  }

  async start({ event, qty, filters = {} }) {
    if (this.isActive()) {
      throw new SessionError('A booking session is already active. Stop it before starting another.', 409);
    }
    const adapter = this.pickAdapter(event);
    if (!adapter) throw new SessionError('No booking adapter can handle this event.');

    const at = this.now().toISOString();
    this.#state = {
      id: randomUUID(),
      event: {
        id: event.id, source: event.source, sourceName: event.sourceName ?? event.source,
        name: event.name, url: event.url, venue: event.venue ?? null, start: event.start ?? null,
      },
      qty,
      filters,
      adapter: { id: adapter.id, label: adapter.label },
      status: 'starting',
      pauseReason: null,
      pauseDetails: [],
      message: 'Connecting to Chrome…',
      currentStep: null,
      doneSteps: [],
      challengeVisible: [],
      lastUrl: null,
      timeline: [],
      createdAt: at,
      updatedAt: at,
    };
    this.#log('info', `Assist started with the "${adapter.label}" adapter.`);
    this.#persist();

    try {
      const context = await this.browser.getContext();
      const page = await context.newPage();
      await this.#attach(page, adapter);
    } catch (err) {
      this.#fail(err);
      throw err;
    }
    this.#run();
    return this.current();
  }

  pause() {
    this.#require('running', 'your_turn');
    this.#set({
      status: 'paused', resumeTo: this.#state.status, pauseReason: 'user', pauseDetails: [],
      message: 'Paused. Click Continue when you are ready.',
    });
    this.#log('pause', 'Paused by you.');
    this.emit('paused', { sessionId: this.#state.id, reason: 'user', details: [] });
    return this.current();
  }

  async continue() {
    if (this.#state?.status === 'interrupted') return this.#reattach();
    this.#require('paused');
    this.#resume('user');
    return this.current();
  }

  async stop() {
    if (!this.isActive()) throw new SessionError('There is no active session.', 409);
    this.#set({ status: 'stopped', message: 'Stopped. The Chrome tab is left open for you.' });
    this.#log('info', 'Stopped by you.');
    await this.#detach();
    return this.current();
  }

  // --- internals -----------------------------------------------------------

  async #reattach() {
    const state = this.#state;
    const adapter = this.pickAdapter(state.event);
    if (!adapter) throw new SessionError('The adapter for this session is no longer available.');
    this.#set({ status: 'starting', message: 'Re-attaching to Chrome…' });
    try {
      const target = state.lastUrl ?? state.event.url;
      let page = await this.browser.findPage((url) => sameDocument(url, target));
      if (page) {
        this.#log('info', 'Found the session tab again.');
      } else {
        const context = await this.browser.getContext();
        page = await context.newPage();
        this.#set({ doneSteps: [] }); // tab is gone: redo the steps from the start
        this.#log('info', 'Original tab not found; starting over in a new tab.');
      }
      await this.#attach(page, adapter);
    } catch (err) {
      this.#fail(err);
      throw err;
    }
    this.#run();
    return this.current();
  }

  async #attach(page, adapter) {
    const abort = new AbortController();
    const runtime = { page, adapter, abort, stopScreencast: null, listeners: [] };
    this.#runtime = runtime;

    const onClose = () => {
      if (this.#runtime !== runtime || !this.isActive()) return;
      this.#set({ status: 'stopped', message: 'The Chrome tab was closed.' });
      this.#log('info', 'Chrome tab closed; session stopped.');
      this.#detach();
    };
    const onNavigate = (frame) => {
      if (this.#runtime !== runtime || frame !== page.mainFrame()) return;
      const url = page.url();
      this.#set({ lastUrl: url });
      if (adapter.isPaymentUrl?.(url)) this.#handoffToPayment(); // fastest possible stop
    };
    page.on('close', onClose);
    page.on('framenavigated', onNavigate);
    runtime.listeners.push(['close', onClose], ['framenavigated', onNavigate]);

    await page.bringToFront().catch(() => {});
    try {
      runtime.stopScreencast = await this.startScreencast(
        page,
        (frame) => this.emit('frame', { sessionId: this.#state.id, ...frame }),
        // Never forward frames once we're on (or heading to) a payment page.
        { shouldSend: () => this.#state?.status !== 'at_payment' && !adapter.isPaymentUrl?.(page.url()) },
      );
    } catch (err) {
      this.#log('info', `Live view unavailable: ${err.message}`);
    }
  }

  async #run() {
    const runtime = this.#runtime;
    const { page, adapter, abort } = runtime;
    const state = this.#state;
    const ctx = {
      signal: abort.signal,
      step: (id, label, fn) => this.#step(runtime, id, label, fn),
      waitFor: (id, label, predicate, options) => this.#waitFor(runtime, id, label, predicate, options),
      log: (message) => this.#log('info', message),
    };

    try {
      this.#set({ status: 'running', message: 'Preparing your booking…' });
      await adapter.prepare(page, { event: state.event, qty: state.qty, filters: state.filters }, ctx);
      await this.#checkpoint(runtime);
      this.#set({
        status: 'your_turn',
        currentStep: null,
        message: adapter.handoffMessage ?? 'Your turn: choose your seats in Chrome, then continue to checkout.',
      });
      this.#log('handoff', 'Handed over to you. Waiting for the payment page.');
      this.emit('paused', { sessionId: state.id, reason: 'your_turn', details: [] });
      await this.#watchUntilPayment(runtime);
    } catch (err) {
      if (this.#runtime !== runtime) return;
      if (err instanceof PaymentReached) this.#handoffToPayment();
      else if (err instanceof AbortedError || TERMINAL_STATUSES.has(this.#state.status)) return;
      else this.#fail(err);
    }
  }

  async #step(runtime, id, label, fn) {
    if (this.#state.doneSteps.includes(id)) return; // already done before a pause/restart
    await this.#checkpoint(runtime);
    this.#set({ currentStep: { id, label } });
    this.#log('step', label);
    await fn();
    this.#set({ doneSteps: [...this.#state.doneSteps, id], currentStep: null });
    await this.delay({ signal: runtime.abort.signal });
    await this.#checkpoint(runtime);
  }

  /**
   * Poll `predicate` until true, running a checkpoint between polls so queues
   * and challenges that appear while waiting still pause the session. Time
   * spent paused doesn't count toward the timeout.
   */
  async #waitFor(runtime, id, label, predicate, { timeoutMs = 180_000, intervalMs = 500 } = {}) {
    if (this.#state.doneSteps.includes(id)) return;
    await this.#checkpoint(runtime);
    this.#set({ currentStep: { id, label } });
    this.#log('step', label);

    let deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await Promise.resolve().then(predicate).catch(() => false)) break;
      await sleep(intervalMs, runtime.abort.signal);
      const before = Date.now();
      await this.#checkpoint(runtime);
      deadline += Date.now() - before;
      if (Date.now() > deadline) throw new SessionError(`Timed out: ${label}.`);
    }
    this.#set({ doneSteps: [...this.#state.doneSteps, id], currentStep: null });
    await this.delay({ signal: runtime.abort.signal });
    await this.#checkpoint(runtime);
  }

  /** Throws PaymentReached / AbortedError; blocks while paused. */
  async #checkpoint(runtime) {
    const { page, abort } = runtime;
    if (abort.signal.aborted) throw new AbortedError();
    if (await this.#atPayment(runtime)) throw new PaymentReached();

    const challenge = await this.detectChallenge(page);
    if (challenge.detected && this.#state.status === 'running') this.#pauseForChallenge(challenge.reasons);

    while (this.#state.status === 'paused') {
      await sleep(this.pollMs, abort.signal);
      if (await this.#atPayment(runtime)) throw new PaymentReached();
      if (this.#state.pauseReason === 'challenge') {
        const again = await this.detectChallenge(page);
        if (!again.detected) this.#resume('auto');
      }
    }
    if (abort.signal.aborted) throw new AbortedError();
  }

  async #watchUntilPayment(runtime) {
    const { page, abort } = runtime;
    for (;;) {
      await sleep(this.pollMs, abort.signal);
      if (await this.#atPayment(runtime)) throw new PaymentReached();
      if (this.#state.status !== 'your_turn') continue; // paused by the user
      const { detected, reasons } = await this.detectChallenge(page);
      const visible = detected ? reasons : [];
      if (visible.join('|') !== this.#state.challengeVisible.join('|')) {
        this.#set({ challengeVisible: visible });
        if (detected) {
          this.#log('pause', `Challenge on the page: ${reasons.join(', ')}. It's yours to complete.`);
          this.emit('paused', { sessionId: this.#state.id, reason: 'challenge', details: reasons });
        }
      }
    }
  }

  async #atPayment({ page, adapter }) {
    if (page.isClosed?.()) return false;
    if (adapter.isPaymentUrl?.(page.url())) return true;
    try {
      return Boolean(await adapter.isAtPayment(page));
    } catch {
      return false;
    }
  }

  #pauseForChallenge(reasons) {
    this.#set({
      status: 'paused',
      resumeTo: 'running',
      pauseReason: 'challenge',
      pauseDetails: reasons,
      message: 'Action needed: your turn. Complete the check or wait in the queue in Chrome. I will resume automatically.',
    });
    this.#log('pause', `Paused: ${reasons.join(', ')}.`);
    this.emit('paused', { sessionId: this.#state.id, reason: 'challenge', details: reasons });
    this.#runtime?.page.bringToFront().catch(() => {});
  }

  #resume(by) {
    const status = this.#state.resumeTo ?? 'running';
    this.#set({
      status,
      resumeTo: null,
      pauseReason: null,
      pauseDetails: [],
      message: status === 'your_turn'
        ? 'Your turn: choose your seats in Chrome, then continue to checkout.'
        : 'Resumed. Preparing your booking…',
    });
    this.#log('resume', by === 'auto' ? 'Challenge cleared; resumed automatically.' : 'Resumed by you.');
    this.emit('resumed', { sessionId: this.#state.id, by });
  }

  #handoffToPayment() {
    if (!this.#state || TERMINAL_STATUSES.has(this.#state.status)) return;
    const runtime = this.#runtime;
    runtime?.abort.abort(); // stop all automation immediately
    this.#set({
      status: 'at_payment',
      currentStep: null,
      pauseReason: null,
      message: 'Complete payment yourself in Chrome. Automation has stopped; nothing on this page is read or recorded.',
    });
    this.#log('handoff', 'Payment page reached. Automation stopped.');
    this.emit('payment', { sessionId: this.#state.id });
    runtime?.page.bringToFront().catch(() => {});
    this.#detach();
  }

  #fail(err) {
    const message = err?.expose ? err.message : `Automation error: ${err?.message ?? err}`;
    this.#set({ status: 'error', currentStep: null, message });
    this.#log('error', message);
    this.#detach();
  }

  async #detach() {
    const runtime = this.#runtime;
    if (!runtime) return;
    this.#runtime = null;
    runtime.abort.abort();
    for (const [name, fn] of runtime.listeners) runtime.page.off?.(name, fn);
    await runtime.stopScreencast?.().catch(() => {});
  }

  #require(...statuses) {
    if (!this.#state || !statuses.includes(this.#state.status)) {
      throw new SessionError(`Not allowed while the session is ${this.#state?.status ?? 'not started'}.`, 409);
    }
  }

  #set(patch) {
    Object.assign(this.#state, patch, { updatedAt: this.now().toISOString() });
    this.#persist();
  }

  #log(kind, message) {
    this.#state.timeline = [...this.#state.timeline, { at: this.now().toISOString(), kind, message }].slice(-MAX_TIMELINE);
    this.#persist();
  }

  #persist() {
    this.store.sessions.save(this.#state);
    this.emit('update', this.current());
  }
}

function sameDocument(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}
