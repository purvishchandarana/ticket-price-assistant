// Optional out-of-app alerts. Each channel is enabled only when configured.

import nodemailer from 'nodemailer';

export function createNotifier(config, { fetchImpl = globalThis.fetch } = {}) {
  const channels = [];

  if (config.smtpUrl && config.emailTo) {
    const transport = nodemailer.createTransport(config.smtpUrl);
    channels.push({
      name: 'email',
      send: (alert) => transport.sendMail({
        from: config.emailFrom || config.emailTo,
        to: config.emailTo,
        subject: `[Ticket Assistant] ${alert.title}`,
        text: `${alert.message}\n\n${alert.url ?? ''}`.trim(),
      }),
    });
  }

  if (config.twilioAccountSid && config.twilioAuthToken && config.twilioFrom && config.smsTo) {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`;
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
    channels.push({
      name: 'sms',
      async send(alert) {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            From: config.twilioFrom,
            To: config.smsTo,
            Body: `${alert.title}\n${alert.url ?? ''}`.trim().slice(0, 300),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
      },
    });
  }

  return {
    channels: channels.map((c) => c.name),
    async notify(alert) {
      const results = await Promise.allSettled(channels.map((c) => c.send(alert)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.warn(`[notify] ${channels[i].name} failed:`, r.reason?.message);
      });
    },
  };
}
