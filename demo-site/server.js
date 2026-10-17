// DemoTix: a fictional, local-only ticket site for exercising the booking
// assistant end to end (search → assist → queue/human check → seats → payment).
// No real CAPTCHA, no card fields, no external requests.

import express from 'express';

const PORT = Number(process.env.DEMO_PORT ?? 4100);
const HOST = '127.0.0.1';

const EVENTS = [
  {
    id: 'midnight-ragas-mumbai',
    name: 'The Midnight Ragas Live',
    category: 'concerts',
    date: '2026-12-12', time: '19:30:00',
    venue: { name: 'Harbour Dome', city: 'Mumbai' },
    status: 'onsale',
    flow: 'queue', // Find tickets → waiting room → seats
    sections: [
      { id: 'gold', name: 'Gold Circle', price: 4500, fee: 450, gstRate: 0.18, available: 40 },
      { id: 'silver', name: 'Silver', price: 2500, fee: 250, gstRate: 0.18, available: 120 },
      { id: 'lawn', name: 'Lawn', price: 999, fee: 100, gstRate: 0.18, available: 300 },
    ],
  },
  {
    id: 'laugh-riot-bengaluru',
    name: 'Laugh Riot: Open Mic Special',
    category: 'comedy',
    date: '2026-11-08', time: '20:00:00',
    venue: { name: 'Basement Stage', city: 'Bengaluru' },
    status: 'onsale',
    flow: 'direct',
    sections: [
      { id: 'front', name: 'Front Rows', price: 799, fee: 40, gstRate: 0.18, available: 30 },
      { id: 'general', name: 'General', price: 449, fee: 25, gstRate: 0, available: 80 },
    ],
  },
  {
    id: 'mavericks-vs-panthers',
    name: 'City Derby: Mumbai Mavericks vs Pune Panthers',
    category: 'sports',
    date: '2026-11-22', time: '18:00:00',
    venue: { name: 'Seaside Stadium', city: 'Mumbai' },
    status: 'onsale',
    flow: 'verify', // Find tickets → "verify you are human" (demo) → seats
    sections: [
      { id: 'pavilion', name: 'Pavilion', price: 3000, fee: 150, gstRate: 0.18, available: 60 },
      { id: 'stands', name: 'East Stands', price: 600, fee: 30, gstRate: 0.18, available: 500 },
    ],
  },
  {
    id: 'monsoon-letters-delhi',
    name: 'The Monsoon Letters (a play)',
    category: 'theatre',
    date: '2027-01-15', time: '19:00:00',
    venue: { name: 'Lantern Theatre', city: 'Delhi' },
    status: 'scheduled', // flip it on the /admin page to test watcher alerts
    onSaleAt: '2026-12-01T06:30:00.000Z',
    flow: 'direct',
    sections: [
      { id: 'stalls', name: 'Stalls', price: 1200, fee: 60, gstRate: 0.18, available: 0 },
      { id: 'balcony', name: 'Balcony', price: 700, fee: 35, gstRate: 0.18, available: 0 },
    ],
  },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');
const findEvent = (id) => EVENTS.find((e) => e.id === id);

function page(title, body, { head = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · DemoTix</title>
<style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #f6f5fb; color: #1d1b26; }
  header { background: #3b2a8c; color: #fff; padding: 12px 20px; display: flex; gap: 12px; align-items: baseline; }
  header strong { font-size: 20px; } header span { opacity: .75; font-size: 13px; }
  main { max-width: 820px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgb(0 0 0 / .08); margin-bottom: 16px; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; font-size: 14px; }
  select, input { font: inherit; padding: 8px 10px; border: 1px solid #c9c6d8; border-radius: 8px; min-width: 200px; }
  button, .btn { font: inherit; background: #3b2a8c; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; text-decoration: none; display: inline-block; margin-top: 16px; }
  button:disabled { background: #9a94b8; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; } td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid #eee; }
  .seats { display: grid; grid-template-columns: repeat(10, 34px); gap: 6px; margin: 8px 0 16px; }
  .seat { width: 34px; height: 30px; margin: 0; padding: 0; font-size: 11px; background: #e4e1f2; color: #1d1b26; border-radius: 6px; }
  .seat.sel { background: #1f9d55; color: #fff; } .seat:disabled { background: #ccc; }
  .muted { color: #6b6880; font-size: 14px; } .demo { background: #fff4d6; border: 1px solid #f0d58c; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
</style>${head}</head><body>
<header><strong>DemoTix</strong><span>Fictional demo site for Ticket Price Assistant. Nothing here is real.</span></header>
<main>${body}</main></body></html>`;
}

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

// --- JSON API used by the assistant's DemoProvider ------------------------
app.get('/api/events', (_req, res) => res.json(EVENTS));

// --- Pages ----------------------------------------------------------------
app.get('/', (_req, res) => {
  res.send(page('Events', `<div class="card"><h1>Upcoming events</h1><ul>${EVENTS.map((e) =>
    `<li><a href="/events/${e.id}">${esc(e.name)}</a> <span class="muted">${esc(e.venue.city)} · ${e.date} · ${e.status}</span></li>`).join('')}</ul>
    <p class="muted"><a href="/admin">Admin (simulate on-sale / price changes)</a></p></div>`));
});

app.get('/events/:id', (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) return res.status(404).send(page('Not found', '<div class="card">Event not found.</div>'));
  const onSale = e.status === 'onsale';
  res.send(page(e.name, `<div class="card">
    <h1>${esc(e.name)}</h1>
    <p class="muted">${esc(e.venue.name)}, ${esc(e.venue.city)} · ${e.date} ${e.time.slice(0, 5)}</p>
    <table><tr><th>Section</th><th>Price</th><th>Fee</th><th>GST</th></tr>${e.sections.map((s) =>
      `<tr><td>${esc(s.name)}</td><td>${inr(s.price)}</td><td>${inr(s.fee)}</td><td>${Math.round(s.gstRate * 100)}%</td></tr>`).join('')}</table>
    ${onSale ? `<form method="get" action="/events/${e.id}/find">
      <label for="qty">Tickets</label>
      <select id="qty" name="qty" data-testid="qty">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option>${n}</option>`).join('')}</select>
      <label for="maxPrice">Max price per ticket (optional)</label>
      <input id="maxPrice" name="maxPrice" type="number" min="0" data-testid="max-price" placeholder="Any">
      <div><button type="submit" data-testid="find-tickets">Find tickets</button></div>
    </form>` : `<p class="demo">Not on sale yet${e.onSaleAt ? ` (opens ${new Date(e.onSaleAt).toLocaleString('en-IN')})` : ''}.</p>`}
  </div>`));
});

app.get('/events/:id/find', (req, res) => {
  const e = findEvent(req.params.id);
  if (!e || e.status !== 'onsale') return res.redirect(`/events/${req.params.id}`);
  const params = new URLSearchParams({ qty: String(req.query.qty ?? 1), maxPrice: String(req.query.maxPrice ?? '') });
  const seats = `/events/${e.id}/seats?${params}`;
  if (e.flow === 'queue') return res.redirect(`/queue?next=${encodeURIComponent(seats)}`);
  if (e.flow === 'verify') return res.redirect(`/verify?next=${encodeURIComponent(seats)}`);
  res.redirect(seats);
});

app.get('/queue', (req, res) => {
  const next = safeNext(req.query.next);
  res.send(page('Waiting room', `<div class="card">
    <h1>You are now in line</h1>
    <p>This is the demo waiting room. You'll move on automatically in <b id="t">8</b> seconds.</p>
    <p class="muted">The assistant pauses here and resumes once the queue page is gone.</p>
  </div>
  <script>let t=8;setInterval(()=>{t--;document.getElementById('t').textContent=t;if(t<=0)location.href=${JSON.stringify(next)};},1000);</script>`));
});

app.get('/verify', (req, res) => {
  const next = safeNext(req.query.next);
  res.send(page('Verify you are human', `<div class="card">
    <h1>Verify you are human</h1>
    <p class="demo">Demo check only. This stands in for a CAPTCHA, which the assistant never solves. You complete it.</p>
    <form method="get" action="${esc(next.split('?')[0])}">
      ${[...new URLSearchParams(next.split('?')[1] ?? '')].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
      <label><input type="checkbox" id="human" onchange="document.getElementById('go').disabled=!this.checked"> I am a human</label>
      <button id="go" type="submit" disabled>Continue</button>
    </form></div>`));
});

app.get('/events/:id/seats', (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) return res.redirect('/');
  const qty = Math.min(Math.max(Number(req.query.qty) || 1, 1), 8);
  const maxPrice = Number(req.query.maxPrice) || Infinity;
  const sections = e.sections.filter((s) => s.price <= maxPrice && s.available > 0);
  res.send(page(`${e.name}: choose seats`, `<div class="card" data-testid="seat-map">
    <h1>Choose ${qty} seat${qty > 1 ? 's' : ''}</h1>
    <p class="muted">${esc(e.name)}${Number.isFinite(maxPrice) ? ` · max ${inr(maxPrice)} per ticket` : ''}. Seat choice is always yours.</p>
    ${sections.length === 0 ? '<p class="demo">No sections match your price filter.</p>' : sections.map((s) => `
      <h3>${esc(s.name)} · ${inr(s.price)}</h3>
      <div class="seats">${Array.from({ length: 20 }, (_, i) => {
        const taken = (i * 7 + s.price) % 5 === 0;
        return `<button type="button" class="seat" data-seat="${s.id}-${i + 1}" ${taken ? 'disabled' : ''}>${i + 1}</button>`;
      }).join('')}</div>`).join('')}
    <form method="get" action="/checkout/review">
      <input type="hidden" name="event" value="${e.id}"><input type="hidden" name="seats" id="seats">
      <button id="cont" type="submit" disabled>Continue to checkout</button>
    </form></div>
  <script>
    const qty=${qty};const chosen=new Set();
    document.querySelectorAll('.seat:not(:disabled)').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.seat; if(chosen.has(id)){chosen.delete(id);b.classList.remove('sel');}
      else if(chosen.size<qty){chosen.add(id);b.classList.add('sel');}
      document.getElementById('seats').value=[...chosen].join(',');
      document.getElementById('cont').disabled=chosen.size!==qty;
    }));
  </script>`));
});

app.get('/checkout/review', (req, res) => {
  const e = findEvent(String(req.query.event));
  const seats = String(req.query.seats ?? '').split(',').filter(Boolean).slice(0, 8);
  if (!e || seats.length === 0) return res.redirect('/');
  const lines = seats.map((seat) => e.sections.find((s) => seat.startsWith(`${s.id}-`))).filter(Boolean);
  const base = lines.reduce((n, s) => n + s.price, 0);
  const fees = lines.reduce((n, s) => n + s.fee, 0);
  const gst = Math.round(lines.reduce((n, s) => n + s.price * s.gstRate + s.fee * 0.18, 0) * 100) / 100;
  res.send(page('Review order', `<div class="card">
    <h1>Review your order</h1>
    <table><tr><td>Tickets (${seats.map(esc).join(', ')})</td><td>${inr(base)}</td></tr>
      <tr><td>Convenience fee</td><td>${inr(fees)}</td></tr>
      <tr><td>GST</td><td>${inr(gst)}</td></tr>
      <tr><th>Total</th><th>${inr(base + fees + gst)}</th></tr></table>
    <a class="btn" href="/checkout/payment?event=${e.id}">Proceed to payment</a></div>`));
});

app.get('/checkout/payment', (_req, res) => {
  res.send(page('Payment', `<div class="card" data-testid="payment-step">
    <h1>Payment</h1>
    <p class="demo">Demo payment step. There is no card form here. On a real site this is where <b>you</b> pay; the assistant stops before this page is shown.</p>
    <a class="btn" href="/done">Finish demo</a></div>`));
});

app.get('/done', (_req, res) => res.send(page('Done', '<div class="card"><h1>Demo complete</h1><p><a href="/">Back to events</a></p></div>')));

// --- Admin: simulate changes so the watcher has something to alert on ------
app.get('/admin', (_req, res) => {
  res.send(page('Admin', `<div class="card"><h1>Simulate changes</h1>${EVENTS.map((e) => `
    <form method="post" action="/admin/${e.id}" style="margin-bottom:12px">
      <b>${esc(e.name)}</b> <span class="muted">${e.status} · from ${inr(Math.min(...e.sections.map((s) => s.price)))}</span><br>
      <button name="action" value="onsale">Put on sale</button>
      <button name="action" value="soldout">Sell out</button>
      <button name="action" value="pricedrop">Drop prices 10%</button>
    </form>`).join('')}</div>`));
});

app.post('/admin/:id', (req, res) => {
  const e = findEvent(req.params.id);
  if (e) {
    if (req.body.action === 'onsale') { e.status = 'onsale'; e.sections.forEach((s) => { if (s.available === 0) s.available = 50; }); }
    if (req.body.action === 'soldout') { e.status = 'soldout'; e.sections.forEach((s) => { s.available = 0; }); }
    if (req.body.action === 'pricedrop') e.sections.forEach((s) => { s.price = Math.round(s.price * 0.9); });
  }
  res.redirect('/admin');
});

app.listen(PORT, HOST, () => console.log(`DemoTix demo site on http://${HOST}:${PORT}`));
