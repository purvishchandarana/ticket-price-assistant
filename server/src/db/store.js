// SQLite persistence (Node's built-in node:sqlite): watchlist, price history,
// alerts and booking-session state.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `CREATE TABLE watchlist (
     event_id          TEXT PRIMARY KEY,
     source            TEXT NOT NULL,
     source_event_id   TEXT NOT NULL,
     name              TEXT NOT NULL,
     url               TEXT,
     category          TEXT,
     qty               INTEGER NOT NULL,
     event_json        TEXT NOT NULL,
     last_status       TEXT,
     last_total_minor  INTEGER,
     last_currency     TEXT,
     last_confidence   TEXT,
     last_checked_at   TEXT,
     last_error        TEXT,
     created_at        TEXT NOT NULL
   );
   CREATE TABLE price_history (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id     TEXT NOT NULL REFERENCES watchlist(event_id) ON DELETE CASCADE,
     checked_at   TEXT NOT NULL,
     status       TEXT,
     total_minor  INTEGER,
     currency     TEXT,
     confidence   TEXT
   );
   CREATE INDEX price_history_event ON price_history(event_id, checked_at);
   CREATE TABLE alerts (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id    TEXT,
     type        TEXT NOT NULL,
     title       TEXT NOT NULL,
     message     TEXT NOT NULL,
     url         TEXT,
     created_at  TEXT NOT NULL,
     read_at     TEXT
   );
   CREATE TABLE sessions (
     id          TEXT PRIMARY KEY,
     status      TEXT NOT NULL,
     state_json  TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL
   );`,
];

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

const fromWatchRow = (row) => row && ({
  eventId: row.event_id,
  source: row.source,
  sourceEventId: row.source_event_id,
  name: row.name,
  url: row.url,
  category: row.category,
  qty: row.qty,
  event: JSON.parse(row.event_json),
  lastStatus: row.last_status,
  lastTotalMinor: row.last_total_minor,
  lastCurrency: row.last_currency,
  lastConfidence: row.last_confidence,
  lastCheckedAt: row.last_checked_at,
  lastError: row.last_error,
  createdAt: row.created_at,
});

const fromAlertRow = (row) => row && ({
  id: row.id,
  eventId: row.event_id,
  type: row.type,
  title: row.title,
  message: row.message,
  url: row.url,
  createdAt: row.created_at,
  readAt: row.read_at,
});

/** @param {string} file  path, or ':memory:' for tests */
export function openStore(file, { now = () => new Date() } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  const iso = () => now().toISOString();

  const watchlist = {
    list: () => db.prepare('SELECT * FROM watchlist ORDER BY created_at DESC').all().map(fromWatchRow),
    get: (eventId) => fromWatchRow(db.prepare('SELECT * FROM watchlist WHERE event_id = ?').get(eventId)),
    add(event, qty) {
      db.prepare(`
        INSERT INTO watchlist (event_id, source, source_event_id, name, url, category, qty, event_json,
                               last_status, last_total_minor, last_currency, last_confidence, last_checked_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET qty = excluded.qty, event_json = excluded.event_json
      `).run(
        event.id, event.source, event.sourceEventId, event.name, event.url ?? null, event.category ?? null, qty,
        JSON.stringify(event), event.onSale?.status ?? null, event.price?.totalMinor ?? null,
        event.price?.currency ?? null, event.price?.confidence ?? null, iso(), iso(),
      );
      return watchlist.get(event.id);
    },
    remove: (eventId) => db.prepare('DELETE FROM watchlist WHERE event_id = ?').run(eventId).changes > 0,
    recordCheck(eventId, event) {
      const checkedAt = iso();
      db.prepare(`
        UPDATE watchlist SET event_json = ?, last_status = ?, last_total_minor = ?, last_currency = ?,
               last_confidence = ?, last_checked_at = ?, last_error = NULL WHERE event_id = ?
      `).run(JSON.stringify(event), event.onSale?.status ?? null, event.price?.totalMinor ?? null,
        event.price?.currency ?? null, event.price?.confidence ?? null, checkedAt, eventId);
      db.prepare(`
        INSERT INTO price_history (event_id, checked_at, status, total_minor, currency, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId, checkedAt, event.onSale?.status ?? null, event.price?.totalMinor ?? null,
        event.price?.currency ?? null, event.price?.confidence ?? null);
      return watchlist.get(eventId);
    },
    recordError(eventId, message) {
      db.prepare('UPDATE watchlist SET last_error = ?, last_checked_at = ? WHERE event_id = ?').run(message, iso(), eventId);
      return watchlist.get(eventId);
    },
    history: (eventId, limit = 100) => db.prepare(`
        SELECT checked_at AS checkedAt, status, total_minor AS totalMinor, currency, confidence
        FROM price_history WHERE event_id = ? ORDER BY checked_at DESC, id DESC LIMIT ?
      `).all(eventId, limit),
  };

  const alerts = {
    add({ eventId = null, type, title, message, url = null }) {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO alerts (event_id, type, title, message, url, created_at) VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId, type, title, message, url, iso());
      return fromAlertRow(db.prepare('SELECT * FROM alerts WHERE id = ?').get(lastInsertRowid));
    },
    list: ({ limit = 50 } = {}) =>
      db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit).map(fromAlertRow),
    unreadCount: () => db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE read_at IS NULL').get().n,
    markRead(ids) {
      if (ids === 'all') return db.prepare('UPDATE alerts SET read_at = ? WHERE read_at IS NULL').run(iso()).changes;
      const stmt = db.prepare('UPDATE alerts SET read_at = ? WHERE id = ? AND read_at IS NULL');
      return ids.reduce((n, id) => n + stmt.run(iso(), id).changes, 0);
    },
  };

  const sessions = {
    save(state) {
      db.prepare(`
        INSERT INTO sessions (id, status, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, state_json = excluded.state_json, updated_at = excluded.updated_at
      `).run(state.id, state.status, JSON.stringify(state), state.createdAt ?? iso(), iso());
    },
    get(id) {
      const row = db.prepare('SELECT state_json FROM sessions WHERE id = ?').get(id);
      return row ? JSON.parse(row.state_json) : null;
    },
    latest() {
      const row = db.prepare('SELECT state_json FROM sessions ORDER BY updated_at DESC LIMIT 1').get();
      return row ? JSON.parse(row.state_json) : null;
    },
  };

  return { watchlist, alerts, sessions, close: () => db.close() };
}
