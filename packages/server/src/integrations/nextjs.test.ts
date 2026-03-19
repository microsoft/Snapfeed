/**
 * Unit tests for the Next.js App Router feedback handler.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackAdapter } from './nextjs.js'
import { createFeedbackHandler } from './nextjs.js'

// ── Helpers ──────────────────────────────────────────────────────────

const sampleEvent = (overrides: Record<string, unknown> = {}) => ({
  session_id: 'sess-1',
  seq: 1,
  ts: '2026-03-19T18:00:00.000Z',
  event_type: 'feedback',
  page: '/home',
  target: 'button.save',
  detail: { message: 'test feedback' },
  screenshot: null,
  ...overrides,
})

function makeAdapter(name: string): FeedbackAdapter & { send: ReturnType<typeof vi.fn> } {
  return {
    name,
    send: vi.fn().mockResolvedValue({ ok: true }),
  }
}

function postRequest(events: unknown[]) {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  })
}

function getRequest() {
  return new Request('http://localhost/api/feedback', { method: 'GET' })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ── POST tests ───────────────────────────────────────────────────────

describe('POST /api/feedback', () => {
  it('calls adapters and returns accepted count', async () => {
    const adapter1 = makeAdapter('slack')
    const adapter2 = makeAdapter('discord')

    const handler = createFeedbackHandler({ adapters: [adapter1, adapter2] })
    const res = await handler.POST(postRequest([sampleEvent(), sampleEvent({ seq: 2 })]))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(2)

    // Each adapter should be called once per event
    expect(adapter1.send).toHaveBeenCalledTimes(2)
    expect(adapter2.send).toHaveBeenCalledTimes(2)
  })

  it('returns 400 for empty events', async () => {
    const handler = createFeedbackHandler({ adapters: [makeAdapter('test')] })
    const res = await handler.POST(postRequest([]))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('events')
  })

  it('returns 400 for missing events field', async () => {
    const handler = createFeedbackHandler({ adapters: [makeAdapter('test')] })
    const req = new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await handler.POST(req)
    expect(res.status).toBe(400)
  })

  it('handles adapter failures gracefully', async () => {
    const failAdapter = makeAdapter('fail')
    failAdapter.send.mockRejectedValue(new Error('boom'))

    const handler = createFeedbackHandler({ adapters: [failAdapter] })
    const res = await handler.POST(postRequest([sampleEvent()]))

    // Should still return 200 — adapter failures are logged, not thrown
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(1)
  })

  it('calls onComplete after adapters', async () => {
    const adapter = makeAdapter('test')
    const onComplete = vi.fn()

    const handler = createFeedbackHandler({ adapters: [adapter], onComplete })
    await handler.POST(postRequest([sampleEvent()]))

    expect(onComplete).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-1' }),
      expect.arrayContaining([expect.objectContaining({ ok: true })]),
    )
  })
})

// ── GET tests ────────────────────────────────────────────────────────

describe('GET /api/feedback', () => {
  it('returns adapter names', async () => {
    const handler = createFeedbackHandler({
      adapters: [makeAdapter('slack'), makeAdapter('github')],
    })
    const res = await handler.GET(getRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.adapters).toEqual(['slack', 'github'])
  })
})

// ── Rate limiting ────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('returns 429 after exceeding limit', async () => {
    const handler = createFeedbackHandler({
      adapters: [makeAdapter('test')],
      rateLimit: { max: 2, windowMs: 60_000 },
    })

    // Use up the limit
    const r1 = await handler.POST(postRequest([sampleEvent()]))
    expect(r1.status).toBe(200)
    const r2 = await handler.POST(postRequest([sampleEvent({ seq: 2 })]))
    expect(r2.status).toBe(200)

    // Third should be rate limited
    const r3 = await handler.POST(postRequest([sampleEvent({ seq: 3 })]))
    expect(r3.status).toBe(429)

    const body = await r3.json()
    expect(body.error).toContain('Too many requests')
  })
})

// ── onReceive hook ───────────────────────────────────────────────────

describe('onReceive hook', () => {
  it('skips events when onReceive returns false', async () => {
    const adapter = makeAdapter('test')

    const handler = createFeedbackHandler({
      adapters: [adapter],
      onReceive: (event) => event.seq !== 2, // skip seq=2
    })

    const res = await handler.POST(
      postRequest([sampleEvent({ seq: 1 }), sampleEvent({ seq: 2 }), sampleEvent({ seq: 3 })]),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    // Only 2 of 3 events should be accepted (seq=2 skipped)
    expect(body.accepted).toBe(2)
    expect(adapter.send).toHaveBeenCalledTimes(2)
  })

  it('accepts all events when onReceive returns true', async () => {
    const adapter = makeAdapter('test')

    const handler = createFeedbackHandler({
      adapters: [adapter],
      onReceive: () => true,
    })

    const res = await handler.POST(postRequest([sampleEvent(), sampleEvent({ seq: 2 })]))
    const body = await res.json()
    expect(body.accepted).toBe(2)
  })
})

// ── Origin check ─────────────────────────────────────────────────────

describe('origin allowlist', () => {
  it('blocks disallowed origins', async () => {
    const handler = createFeedbackHandler({
      adapters: [makeAdapter('test')],
      allowedOrigins: ['https://allowed.com'],
    })

    const req = new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.com',
      },
      body: JSON.stringify({ events: [sampleEvent()] }),
    })

    const res = await handler.POST(req)
    expect(res.status).toBe(403)
  })

  it('allows matching origins', async () => {
    const handler = createFeedbackHandler({
      adapters: [makeAdapter('test')],
      allowedOrigins: ['https://allowed.com'],
    })

    const req = new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://allowed.com',
      },
      body: JSON.stringify({ events: [sampleEvent()] }),
    })

    const res = await handler.POST(req)
    expect(res.status).toBe(200)
  })
})
