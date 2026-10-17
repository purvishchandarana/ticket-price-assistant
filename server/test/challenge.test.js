import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { challengeDetected, detectChallenge } from '../src/automation/challenge.js';

describe('detectChallenge', () => {
  it('flags CAPTCHA iframes', () => {
    for (const frame of [
      'https://www.google.com/recaptcha/api2/anchor?k=x',
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html',
      'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2',
      'https://client-api.arkoselabs.com/fc/gc/',
      'https://geo.captcha-delivery.com/captcha/?initialCid=x',
    ]) {
      const r = detectChallenge({ url: 'https://tickets.example/event/1', frameUrls: [frame] });
      assert.equal(r.detected, true, frame);
    }
  });

  it('flags queue and waiting-room URLs', () => {
    for (const url of [
      'https://example.queue-it.net/?c=example&e=bigshow',
      'https://tickets.example/queue?next=/seats',
      'https://queue.tickets.example/event/1',
      'https://tickets.example/waiting-room/abc',
      'https://tickets.example/cdn-cgi/challenge-platform/h/g/orchestrate',
    ]) {
      assert.equal(detectChallenge({ url }).detected, true, url);
    }
  });

  it('flags challenge text', () => {
    for (const text of [
      'Please verify you are human to continue',
      "Verify you're a human",
      "I'm not a robot",
      'Checking your browser before accessing the site',
      'You are now in line. Estimated wait: 5 minutes',
      'Press & Hold to confirm you are a human',
    ]) {
      assert.equal(detectChallenge({ url: 'https://x.example/', text }).detected, true, text);
    }
  });

  it('does not flag ordinary event pages', () => {
    const r = detectChallenge({
      url: 'https://www.district.in/events/queue-the-band-live-buy-tickets',
      frameUrls: ['https://www.youtube.com/embed/abc', 'about:blank'],
      text: 'Queue The Band live in Mumbai. Book tickets now. Humans of Mumbai present…',
      title: 'Queue The Band Live',
    });
    assert.deepEqual(r, { detected: false, reasons: [] });
  });

  it('reports every reason found', () => {
    const r = detectChallenge({
      url: 'https://tickets.example/queue',
      frameUrls: ['https://www.google.com/recaptcha/api2/anchor'],
      text: 'Verify you are human',
    });
    assert.equal(r.reasons.length, 3);
  });
});

describe('challengeDetected(page)', () => {
  const fakePage = ({ url, frames = [], title = '', text = '' }) => ({
    url: () => url,
    frames: () => frames.map((f) => ({ url: () => f })),
    title: async () => title,
    evaluate: async () => text,
  });

  it('snapshots the page and runs the detector', async () => {
    const r = await challengeDetected(fakePage({ url: 'https://demo.test/verify', title: 'Verify you are human' }));
    assert.equal(r.detected, true);
  });

  it('never throws on a page that cannot be inspected', async () => {
    const broken = { url: () => { throw new Error('closed'); } };
    assert.deepEqual(await challengeDetected(broken), { detected: false, reasons: [] });
  });

  it('tolerates evaluate() failing mid-navigation', async () => {
    const page = { ...fakePage({ url: 'https://x.example/' }), evaluate: async () => { throw new Error('navigating'); } };
    assert.equal((await challengeDetected(page)).detected, false);
  });
});
