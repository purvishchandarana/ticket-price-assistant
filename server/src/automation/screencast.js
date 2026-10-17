// Live view of the assisted tab via CDP Page.startScreencast (JPEG frames).

/**
 * @param {import('playwright-core').Page} page
 * @param {(frame: {data: string, width: number, height: number}) => void} onFrame
 * @param {{shouldSend?: () => boolean}} [options]  return false to drop a frame
 *        (used to never forward frames of payment pages)
 * @returns {Promise<() => Promise<void>>} stop function
 */
export async function startScreencast(page, onFrame, { shouldSend = () => true, quality = 60, maxWidth = 1280, maxHeight = 800 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  let stopped = false;

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (stopped || !shouldSend()) return;
    onFrame({ data, width: metadata.deviceWidth, height: metadata.deviceHeight });
  });

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1 });

  return async function stop() {
    if (stopped) return;
    stopped = true;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
  };
}
