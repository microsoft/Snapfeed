/**
 * @microsoft/snapfeed-server — Hono routes
 *
 * Pluggable route group: call `snapfeedRoutes(db)` and mount into any Hono app.
 * Ported from the Python FastAPI implementation in kidstrophy.
 */

import { Hono } from 'hono'
import type Database from 'better-sqlite3'
import type { TelemetryBatch, StoredEvent, SessionSummary } from './types.js'

export function snapfeedRoutes(db: Database.Database): Hono {
  const app = new Hono()

  // ── POST /api/telemetry/events — ingest a batch ───────────────────
  app.post('/api/telemetry/events', async (c) => {
    const body = await c.req.json<TelemetryBatch>()
    const events = body.events
    if (!Array.isArray(events) || events.length === 0) {
      return c.json({ error: 'events array required' }, 400)
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO ui_telemetry
        (session_id, seq, ts, event_type, page, target, detail_json, screenshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((rows: TelemetryBatch['events']) => {
      for (const e of rows) {
        insert.run(
          e.session_id,
          e.seq,
          e.ts,
          e.event_type,
          e.page ?? null,
          e.target ?? null,
          e.detail ? JSON.stringify(e.detail) : null,
          e.screenshot ?? null,
        )
      }
    })

    insertMany(events)
    return c.json({ accepted: events.length })
  })

  // ── GET /api/telemetry/events — query events ──────────────────────
  app.get('/api/telemetry/events', (c) => {
    const sessionId = c.req.query('session_id')
    const eventType = c.req.query('event_type')
    const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000)

    const clauses: string[] = []
    const params: unknown[] = []

    if (sessionId) {
      clauses.push('session_id = ?')
      params.push(sessionId)
    }
    if (eventType) {
      clauses.push('event_type = ?')
      params.push(eventType)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(limit)

    const rows = db.prepare(
      `SELECT id, session_id, seq, ts, event_type, page, target, detail_json
       FROM ui_telemetry ${where} ORDER BY id DESC LIMIT ?`
    ).all(...params) as StoredEvent[]

    return c.json(rows)
  })

  // ── GET /api/telemetry/sessions — list sessions ───────────────────
  app.get('/api/telemetry/sessions', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20), 100)

    const rows = db.prepare(`
      SELECT session_id,
             MIN(ts) as first_event,
             MAX(ts) as last_event,
             COUNT(*) as event_count,
             SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as error_count
      FROM ui_telemetry
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT ?
    `).all(limit) as SessionSummary[]

    return c.json(rows)
  })

  // ── GET /api/telemetry/events/:id/screenshot — serve JPEG ─────────
  app.get('/api/telemetry/events/:id/screenshot', (c) => {
    const eventId = Number(c.req.param('id'))
    const row = db.prepare(
      'SELECT screenshot FROM ui_telemetry WHERE id = ?'
    ).get(eventId) as { screenshot: string | null } | undefined

    if (!row?.screenshot) {
      return c.json({ error: 'No screenshot for this event' }, 404)
    }

    const jpegBytes = Buffer.from(row.screenshot, 'base64')
    return new Response(jpegBytes, {
      headers: { 'Content-Type': 'image/jpeg' },
    })
  })

  return app
}
