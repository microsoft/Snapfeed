/**
 * Express integration for snapfeed-server.
 *
 * Usage:
 *
 *   import express from 'express'
 *   import { createExpressRouter } from '@microsoft/snapfeed-server/express'
 *   import { openDb } from '@microsoft/snapfeed-server'
 *
 *   const app = express()
 *   const db = openDb({ path: './feedback.db' })
 *   app.use(createExpressRouter(db))
 *   app.listen(3000)
 *
 * This creates the same 4 endpoints as the Hono server, compatible with
 * Express req/res patterns.
 */

import type Database from 'better-sqlite3'
import type { SessionSummary, StoredEvent, TelemetryBatch } from '../types.js'

interface ExpressRequest {
  method: string
  body?: unknown
  query?: Record<string, string | undefined>
  params?: Record<string, string>
  ip?: string
  headers?: Record<string, string | string[] | undefined>
}

interface ExpressResponse {
  json(body: unknown): ExpressResponse
  status(code: number): ExpressResponse
  set(header: string, value: string): ExpressResponse
  send(body: Buffer | string): ExpressResponse
  type(mimeType: string): ExpressResponse
}

type ExpressNext = () => void

type ExpressHandler = (req: ExpressRequest, res: ExpressResponse, next: ExpressNext) => void

interface ExpressRouter {
  post(path: string, ...handlers: ExpressHandler[]): ExpressRouter
  get(path: string, ...handlers: ExpressHandler[]): ExpressRouter
}

export interface ExpressRouterOptions {
  /** Rate limit: max requests per window. Default: 60 */
  rateLimitMax?: number
  /** Rate limit window in ms. Default: 60000 */
  rateLimitWindowMs?: number
}

export function createExpressRouter(
  db: Database.Database,
  options: ExpressRouterOptions = {},
): ExpressRouter {
  // Dynamically require express Router to avoid hard dependency
  // biome-ignore lint/suspicious/noExplicitAny: Express Router is dynamically loaded
  let Router: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Router = require('express').Router
  } catch {
    throw new Error(
      'Express is required for createExpressRouter(). Install it: npm install express',
    )
  }

  const router = Router() as ExpressRouter

  // ── Rate limiting ──────────────────────────────────────────────
  const rateLimitMax = options.rateLimitMax ?? 60
  const rateLimitWindow = options.rateLimitWindowMs ?? 60_000
  const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

  const rateLimitMiddleware: ExpressHandler = (req, res, next) => {
    const ip =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
    const now = Date.now()
    let entry = rateLimitStore.get(ip)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + rateLimitWindow }
      rateLimitStore.set(ip, entry)
    }
    entry.count++
    res.set('X-RateLimit-Limit', String(rateLimitMax))
    res.set('X-RateLimit-Remaining', String(Math.max(0, rateLimitMax - entry.count)))
    if (entry.count > rateLimitMax) {
      res.status(429).json({ error: 'Too many requests' })
      return
    }
    next()
  }

  // ── Routes ─────────────────────────────────────────────────────

  router.post('/api/telemetry/events', rateLimitMiddleware, (req, res) => {
    const body = req.body as TelemetryBatch
    const events = body?.events
    if (!Array.isArray(events) || events.length === 0) {
      res.status(400).json({ error: 'events array required' })
      return
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
    res.json({ accepted: events.length })
  })

  router.get('/api/telemetry/events', (req, res) => {
    const sessionId = req.query?.session_id
    const eventType = req.query?.event_type
    const limit = Math.min(Number(req.query?.limit ?? 200), 1000)

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

    const rows = db
      .prepare(
        `SELECT id, session_id, seq, ts, event_type, page, target, detail_json
       FROM ui_telemetry ${where} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params) as StoredEvent[]

    res.json(rows)
  })

  router.get('/api/telemetry/sessions', (req, res) => {
    const limit = Math.min(Number(req.query?.limit ?? 20), 100)
    const rows = db
      .prepare(
        `SELECT session_id,
              MIN(ts) as first_event,
              MAX(ts) as last_event,
              COUNT(*) as event_count,
              SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as error_count
       FROM ui_telemetry
       GROUP BY session_id
       ORDER BY MAX(created_at) DESC
       LIMIT ?`,
      )
      .all(limit) as SessionSummary[]

    res.json(rows)
  })

  router.get('/api/telemetry/events/:id/screenshot', (req, res) => {
    const eventId = Number(req.params?.id)
    const row = db.prepare('SELECT screenshot FROM ui_telemetry WHERE id = ?').get(eventId) as
      | { screenshot: string | null }
      | undefined

    if (!row?.screenshot) {
      res.status(404).json({ error: 'No screenshot for this event' })
      return
    }

    const jpegBytes = Buffer.from(row.screenshot, 'base64')
    res.type('image/jpeg').send(jpegBytes)
  })

  return router
}
