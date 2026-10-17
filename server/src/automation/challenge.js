// Detects CAPTCHAs, bot checks and queues/waiting rooms so automation can
// pause and hand control to the human. It never interacts with a challenge.

const CHALLENGE_FRAME_PATTERNS = [
  [/google\.com\/recaptcha|recaptcha\.net/i, 'reCAPTCHA iframe'],
  [/hcaptcha\.com/i, 'hCaptcha iframe'],
  [/challenges\.cloudflare\.com|turnstile/i, 'Cloudflare Turnstile iframe'],
  [/arkoselabs\.com|funcaptcha/i, 'Arkose/FunCaptcha iframe'],
  [/geetest\.com/i, 'GeeTest iframe'],
  [/captcha-delivery\.com/i, 'DataDome challenge iframe'],
  [/px-captcha|perimeterx|px-cloud\.net/i, 'HUMAN/PerimeterX challenge iframe'],
];

const QUEUE_URL_PATTERNS = [
  [/queue-it\.net/i, 'Queue-it waiting room'],
  // A whole path segment or hostname label: "/queue?…", "queue.site.com", "/waiting-room/…"
  // but not event slugs like "/events/queue-the-band-live".
  [/(^|[/.])(waiting-?room|queue)([/.?]|$)/i, 'queue / waiting-room URL'],
  [/\/cdn-cgi\/challenge-platform|__cf_chl/i, 'Cloudflare challenge URL'],
  [/[/?&](captcha|challenge|verify-human)([/?=&]|$)/i, 'challenge URL'],
];

const CHALLENGE_TEXT_PATTERNS = [
  [/verify (that )?you('| a)re (a )?human/i, '"verify you are human" text'],
  [/are you a (ro)?bot\b/i, '"are you a robot" text'],
  [/i('|’)?m not a robot/i, '"I\'m not a robot" text'],
  [/checking (if the site connection is secure|your browser)/i, 'browser-check text'],
  [/you are (now )?in (the )?(queue|line)/i, 'queue text'],
  [/\bwaiting room\b/i, 'waiting-room text'],
  [/press (and|&) hold/i, 'press-and-hold challenge text'],
  [/complete the security check/i, 'security-check text'],
  [/unusual traffic from your (computer|network)/i, 'unusual-traffic text'],
];

/**
 * Pure detector over a page snapshot.
 * @param {{url?: string, frameUrls?: string[], text?: string, title?: string}} snapshot
 * @returns {{detected: boolean, reasons: string[]}}
 */
export function detectChallenge({ url = '', frameUrls = [], text = '', title = '' } = {}) {
  const reasons = new Set();

  for (const frameUrl of frameUrls) {
    for (const [pattern, reason] of CHALLENGE_FRAME_PATTERNS) {
      if (pattern.test(frameUrl)) reasons.add(reason);
    }
  }

  let pathAndQuery = url;
  try {
    const u = new URL(url);
    pathAndQuery = `${u.hostname}${u.pathname}${u.search}`;
  } catch {
    // Not an absolute URL; test it as-is.
  }
  for (const [pattern, reason] of QUEUE_URL_PATTERNS) {
    if (pattern.test(pathAndQuery)) reasons.add(reason);
  }

  const haystack = `${title}\n${text}`;
  for (const [pattern, reason] of CHALLENGE_TEXT_PATTERNS) {
    if (pattern.test(haystack)) reasons.add(reason);
  }

  return { detected: reasons.size > 0, reasons: [...reasons] };
}

/**
 * Snapshot a Playwright page and run the detector. Never throws: a page that
 * can't be inspected (mid-navigation, closed) is reported as not detected.
 * @returns {Promise<{detected: boolean, reasons: string[]}>}
 */
export async function challengeDetected(page) {
  try {
    const url = page.url();
    const frameUrls = page.frames().map((f) => f.url());
    const [title, text] = await Promise.all([
      page.title().catch(() => ''),
      page.evaluate(() => document.body?.innerText?.slice(0, 20_000) ?? '').catch(() => ''),
    ]);
    return detectChallenge({ url, frameUrls, text, title });
  } catch {
    return { detected: false, reasons: [] };
  }
}
