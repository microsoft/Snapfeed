/**
 * Unit tests for snapfeed-server security middleware.
 */

import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { originAllowlist, payloadLimits, rateLimit } from './security.js'

// ── Helpers ──────────────────────────────────────────────────────────

function createApp(middleware: Parameters<Hono['use']>[0]) {
  const app = new Hono()
  app.use('/*', middleware)
  app.get('/test', (c) => c.json({ ok: true }))
  app.post('/test', async (c) => {
    // Try to use parsedBody if available, otherwise parse
    const body = c.get('parsedBody') ?? (await c.req.json())
    return c.json({ ok: true, body })
  })
  return app
}

function get(app: Hono, path = '/test', headers?: Record<string, string>) {
  return app.request(path, { method: 'GET', headers })
}

function post(app: Hono, body: unknown, headers?: Record<string, string>) {
  return app.request('/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ── rateLimit ────────────────────────────────────────────────────────

describe('rateLimit', () => {
  it('allows requests within limit', async () => {
    const app = createApp(rateLimit({ max: 3, windowMs: 60_000 }))

    for (let i = 0; i < 3; i++) {
      const res = await get(app, '/test', { 'X-Forwarded-For': '1.2.3.4' })
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 after exceeding limit', async () => {
    const app = createApp(rateLimit({ max: 2, windowMs: 60_000 }))

    // Use up the limit
    await get(app, '/test', { 'X-Forwarded-For': '10.0.0.1' })
    await get(app, '/test', { 'X-Forwarded-For': '10.0.0.1' })

    // Third request should be rate limited
    const res = await get(app, '/test', { 'X-Forwarded-For': '10.0.0.1' })
    expect(res.status).toBe(429)

    const body = await res.json()
    expect(body.error).toContain('Too many requests')
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it('includes X-RateLimit headers', async () => {
    const app = createApp(rateLimit({ max: 5, windowMs: 60_000 }))

    const res = await get(app, '/test', { 'X-Forwarded-For': '5.5.5.5' })
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })

  it('tracks IPs independently', async () => {
    const app = createApp(rateLimit({ max: 1, windowMs: 60_000 }))

    const res1 = await get(app, '/test', { 'X-Forwarded-For': '1.1.1.1' })
    expect(res1.status).toBe(200)

    // Different IP should not be rate limited
    const res2 = await get(app, '/test', { 'X-Forwarded-For': '2.2.2.2' })
    expect(res2.status).toBe(200)

    // Same IP should be rate limited
    const res3 = await get(app, '/test', { 'X-Forwarded-For': '1.1.1.1' })
    expect(res3.status).toBe(429)
  })
})

// ── originAllowlist ──────────────────────────────────────────────────

describe('originAllowlist', () => {
  it('allows matching string origins', async () => {
    const app = createApp(originAllowlist({ origins: ['https://example.com', 'https://app.test'] }))

    const res = await get(app, '/test', { Origin: 'https://example.com' })
    expect(res.status).toBe(200)
  })

  it('allows matching regex origins', async () => {
    const app = createApp(originAllowlist({ origins: [/https:\/\/.*\.example\.com$/] }))

    const res = await get(app, '/test', { Origin: 'https://sub.example.com' })
    expect(res.status).toBe(200)
  })

  it('blocks non-matching origins', async () => {
    const app = createApp(originAllowlist({ origins: ['https://example.com'] }))

    const res = await get(app, '/test', { Origin: 'https://evil.com' })
    expect(res.status).toBe(403)

    const body = await res.json()
    expect(body.error).toContain('Origin not allowed')
  })

  it('allows requests with no origin header', async () => {
    const app = createApp(originAllowlist({ origins: ['https://example.com'] }))

    const res = await get(app, '/test')
    expect(res.status).toBe(200)
  })
})

// ── payloadLimits ────────────────────────────────────────────────────

describe('payloadLimits', () => {
  it('allows normal payloads', async () => {
    const app = createApp(payloadLimits({ maxPayloadBytes: 10_000, maxScreenshotBytes: 5_000 }))

    const res = await post(app, {
      events: [{ session_id: 's', seq: 1, ts: 'now', event_type: 'click' }],
    })
    expect(res.status).toBe(200)
  })

  it('allows GET requests without checking', async () => {
    const app = createApp(payloadLimits({ maxPayloadBytes: 1, maxScreenshotBytes: 1 }))

    const res = await get(app)
    expect(res.status).toBe(200)
  })

  it('rejects oversized screenshots', async () => {
    // Set a very low screenshot limit (100 bytes)
    const app = createApp(payloadLimits({ maxPayloadBytes: 10_000, maxScreenshotBytes: 100 }))

    // Create a base64 string that decodes to >100 bytes
    const bigScreenshot = Buffer.from('x'.repeat(200)).toString('base64')

    const res = await post(app, {
      events: [
        {
          session_id: 's',
          seq: 1,
          ts: 'now',
          event_type: 'feedback',
          screenshot: bigScreenshot,
        },
      ],
    })
    expect(res.status).toBe(413)

    const body = await res.json()
    expect(body.error).toContain('Screenshot')
  })

  it('rejects oversized event payloads', async () => {
    const app = createApp(payloadLimits({ maxPayloadBytes: 50, maxScreenshotBytes: 5_000_000 }))

    const res = await post(app, {
      events: [
        {
          session_id: 's',
          seq: 1,
          ts: 'now',
          event_type: 'feedback',
          detail: { message: 'a'.repeat(200) },
        },
      ],
    })
    expect(res.status).toBe(413)

    const body = await res.json()
    expect(body.error).toContain('payload')
  })
})
