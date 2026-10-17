import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../src/lib/http.js';
import { createRobotsChecker, isPathAllowed, parseRobots, selectGroup } from '../src/lib/robots.js';

const ROBOTS = `
# comment
User-agent: Googlebot
Disallow: /private

User-agent: *
Allow: /
Disallow: /checkout
Disallow: /*?
Disallow: /order*
Allow: /order-help
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: BadBot
User-agent: OtherBot
Disallow: /
`;

describe('robots.txt', () => {
  const groups = parseRobots(ROBOTS);
  const star = selectGroup(groups, 'TicketPriceAssistant');

  it('parses groups, including multi-agent groups', () => {
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[2].agents, ['badbot', 'otherbot']);
    assert.equal(star.crawlDelay, 2);
  });

  it('applies the * group to unknown agents', () => {
    assert.equal(isPathAllowed(star, '/events/some-show-buy-tickets'), true);
    assert.equal(isPathAllowed(star, '/checkout/step1'), false);
    assert.equal(isPathAllowed(star, '/events/x?utm=1'), false); // query strings blocked
    assert.equal(isPathAllowed(star, '/orders/123'), false);
    assert.equal(isPathAllowed(star, '/order-help'), true); // longer Allow wins
    assert.equal(isPathAllowed(star, '/guide.pdf'), false);
    assert.equal(isPathAllowed(star, '/guide.pdf.html'), true); // $ anchors
  });

  it('prefers a specific group for a matching agent', () => {
    const bad = selectGroup(groups, 'BadBot/1.0');
    assert.equal(isPathAllowed(bad, '/events/x'), false);
  });

  it('allows everything when there is no applicable group', () => {
    assert.equal(isPathAllowed(selectGroup(parseRobots('User-agent: Foo\nDisallow: /'), 'Bar'), '/x'), true);
  });

  it('checker: caches per origin, 4xx = allow all, unreachable = disallow all', async () => {
    let calls = 0;
    const responses = {
      'https://a.test/robots.txt': () => ROBOTS,
      'https://missing.test/robots.txt': () => { throw new HttpError('nf', { status: 404 }); },
      'https://down.test/robots.txt': () => { throw new HttpError('err', { status: 503 }); },
    };
    const checker = createRobotsChecker({
      agentToken: 'TicketPriceAssistant',
      http: { getText: async (url) => { calls++; return responses[url](); } },
    });

    assert.deepEqual(await checker.check('https://a.test/events/x'), { allowed: true, crawlDelayMs: 2000 });
    assert.equal((await checker.check('https://a.test/checkout')).allowed, false);
    assert.equal(calls, 1);
    assert.equal((await checker.check('https://missing.test/anything')).allowed, true);
    assert.equal((await checker.check('https://down.test/anything')).allowed, false);
  });
});
