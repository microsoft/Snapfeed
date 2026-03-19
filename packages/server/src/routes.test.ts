/**
 * Unit tests for snapfeed-server Hono routes.
 */

import type Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './db.js'
import { snapfeedRoutes } from './routes.js'

let db: Database.Database
let app: ReturnType<typeof snapfeedRoutes>

beforeEach(() => {
  db = openDb() // in-memory by default
  app = snapfeedRoutes(db)
})

// ── Helpers ──────────────────────────────────────────────────────────

function postEvents(events: unknown[]) {
  return app.request('/api/telemetry/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  })
}

const sampleEvent = (overrides: Record<string, unknown> = {}) => ({
  session_id: 'sess-1',
  seq: 1,
  ts: '2026-03-19T18:00:00.000Z',
  event_type: 'feedback',
  page: '/home',
  target: 'btn',
  detail: { message: 'hi' },
  screenshot: null,
  ...overrides,
})

// ── POST /api/telemetry/events ───────────────────────────────────────

describe('POST /api/telemetry/events', () => {
  it('inserts a batch and returns accepted count', async () => {
    const res = await postEvents([sampleEvent(), sampleEvent({ seq: 2 })])
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.accepted).toBe(2)
  })

  it('returns 400 for empty events array', async () => {
    const res = await postEvents([])
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toContain('events')
  })

  it('returns 400 for missing events', async () => {
    const res = await app.request('/api/telemetry/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// ── GET /api/telemetry/events ────────────────────────────────────────

describe('GET /api/telemetry/events', () => {
  it('returns inserted events', async () => {
    await postEvents([sampleEvent(), sampleEvent({ seq: 2, event_type: 'click' })])

    const res = await app.request('/api/telemetry/events')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toHaveProperty('session_id', 'sess-1')
  })

  it('filters by session_id', async () => {
    await postEvents([sampleEvent(), sampleEvent({ session_id: 'sess-2', seq: 1 })])

    const res = await app.request('/api/telemetry/events?session_id=sess-2')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].session_id).toBe('sess-2')
  })

  it('filters by event_type', async () => {
    await postEvents([
      sampleEvent({ event_type: 'click' }),
      sampleEvent({ seq: 2, event_type: 'feedback' }),
    ])

    const res = await app.request('/api/telemetry/events?event_type=click')
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].event_type).toBe('click')
  })

  it('returns empty array when no events match', async () => {
    const res = await app.request('/api/telemetry/events?session_id=nonexistent')
    const body = await res.json()
    expect(body).toEqual([])
  })
})

// ── GET /api/telemetry/sessions ──────────────────────────────────────

describe('GET /api/telemetry/sessions', () => {
  it('returns session summaries', async () => {
    await postEvents([
      sampleEvent(),
      sampleEvent({ seq: 2, event_type: 'error' }),
      sampleEvent({ session_id: 'sess-2', seq: 1 }),
    ])

    const res = await app.request('/api/telemetry/sessions')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.length).toBe(2)

    const sess1 = body.find((s: Record<string, unknown>) => s.session_id === 'sess-1')
    expect(sess1.event_count).toBe(2)
    expect(sess1.error_count).toBe(1)
  })
})

// ── GET /api/telemetry/events/:id/screenshot ─────────────────────────

describe('GET /api/telemetry/events/:id/screenshot', () => {
  it('returns JPEG for event with screenshot', async () => {
    const screenshotB64 = Buffer.from('fake-jpeg-data').toString('base64')
    await postEvents([sampleEvent({ screenshot: screenshotB64 })])

    // Get the inserted event ID
    const listRes = await app.request('/api/telemetry/events')
    const events = await listRes.json()
    const eventId = events[0].id

    const res = await app.request(`/api/telemetry/events/${eventId}/screenshot`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')

    const buf = await res.arrayBuffer()
    expect(Buffer.from(buf).toString()).toBe('fake-jpeg-data')
  })

  it('returns 404 for event without screenshot', async () => {
    await postEvents([sampleEvent({ screenshot: null })])

    const listRes = await app.request('/api/telemetry/events')
    const events = await listRes.json()
    const eventId = events[0].id

    const res = await app.request(`/api/telemetry/events/${eventId}/screenshot`)
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toContain('screenshot')
  })

  it('returns 404 for nonexistent event', async () => {
    const res = await app.request('/api/telemetry/events/99999/screenshot')
    expect(res.status).toBe(404)
  })
})
