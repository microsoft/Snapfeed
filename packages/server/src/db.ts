/**
 * @microsoft/snapfeed-server — SQLite database layer
 *
 * Uses better-sqlite3 for synchronous access. Auto-creates the schema
 * on first use. Schema matches the Python kidstrophy implementation exactly.
 */

import Database from 'better-sqlite3'

export type { Database as DatabaseType } from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ui_telemetry (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    seq           INTEGER NOT NULL,
    ts            TEXT    NOT NULL,
    event_type    TEXT    NOT NULL,
    page          TEXT,
    target        TEXT,
    detail_json   TEXT,
    created_at    TEXT    DEFAULT (datetime('now')),
    resolved_at   TEXT,
    resolved_note TEXT,
    commit_sha    TEXT,
    screenshot    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_session ON ui_telemetry(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_type ON ui_telemetry(event_type);
`

export interface OpenDbOptions {
  /** Path to the SQLite database file. Default: ':memory:' */
  path?: string
  /** Enable WAL mode for better concurrent read performance. Default: true */
  wal?: boolean
}

export function openDb(options: OpenDbOptions = {}): Database.Database {
  const dbPath = options.path ?? ':memory:'
  const db = new Database(dbPath)

  if (options.wal !== false) {
    db.pragma('journal_mode = WAL')
  }

  db.exec(SCHEMA)
  return db
}
