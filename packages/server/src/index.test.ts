import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapfeedServer, type ServerOptions } from './index.js'

const servers: ReturnType<typeof createSnapfeedServer>[] = []
const allowedOrigin = 'https://app.example.com'
const blockedOrigin = 'https://untrusted.example'
const sampleEvent = {
  session_id: 'sess-1',
  seq: 1,
  ts: '2026-03-19T18:00:00.000Z',
  event_type: 'feedback',
  detail: { message: 'private feedback' },
  screenshot: Buffer.from('fake-jpeg-data').toString('base64'),
}

async function createServer(options: ServerOptions = {}) {
  const instance = createSnapfeedServer({
    port: 0,
    dbPath: ':memory:',
    rateLimitEnabled: false,
    ...options,
  })
  servers.push(instance)
  await once(instance.server, 'listening')
  return instance.app
}

afterEach(async () => {
  for (const { server, db } of servers.splice(0)) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    } finally {
      db.close()
    }
  }
})

function postEvents(app: Awaited<ReturnType<typeof createServer>>, origin?: string) {
  return app.request('/api/telemetry/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin === undefined ? {} : { Origin: origin }),
    },
    body: JSON.stringify({ events: [sampleEvent] }),
  })
}

describe('createSnapfeedServer allowedOrigins', () => {
  it.each([true, false])('rejects ingestion when corsEnabled is %s', async (corsEnabled) => {
    const app = await createServer({ allowedOrigins: [allowedOrigin], corsEnabled })

    const res = await postEvents(app, blockedOrigin)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()

    const events = await app.request('/api/telemetry/events', {
      headers: { Origin: allowedOrigin },
    })
    expect(await events.json()).toEqual([])
  })

  it.each([
    '/api/telemetry/events',
    '/api/telemetry/sessions',
    '/api/telemetry/events/1/screenshot',
  ])('rejects reads from an unlisted origin: %s', async (path) => {
    const app = await createServer({ allowedOrigins: [allowedOrigin] })
    expect((await postEvents(app, allowedOrigin)).status).toBe(200)

    const res = await app.request(path, { headers: { Origin: blockedOrigin } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rejects unlisted origins before CORS preflight handling', async () => {
    const app = await createServer({ allowedOrigins: [allowedOrigin] })
    const res = await app.request('/api/telemetry/events', {
      method: 'OPTIONS',
      headers: {
        Origin: blockedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })

    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows preflight from a listed origin', async () => {
    const app = await createServer({ allowedOrigins: [allowedOrigin] })
    const res = await app.request('/api/telemetry/events', {
      method: 'OPTIONS',
      headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it.each([
    { allowedOrigins: [allowedOrigin] },
    { allowedOrigins: [/^https:\/\/app\.example\.com$/] },
  ])('preserves ingestion and reads for matching allowlists: $allowedOrigins', async ({
    allowedOrigins,
  }) => {
    const app = await createServer({ allowedOrigins })
    const accepted = await postEvents(app, allowedOrigin)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ accepted: 1 })

    const headers = { Origin: allowedOrigin }
    const events = await app.request('/api/telemetry/events', { headers })
    expect(await events.json()).toHaveLength(1)
    const sessions = await app.request('/api/telemetry/sessions', { headers })
    expect(await sessions.json()).toHaveLength(1)
    const screenshot = await app.request('/api/telemetry/events/1/screenshot', { headers })
    expect(screenshot.status).toBe(200)
    expect(screenshot.headers.get('Content-Type')).toBe('image/jpeg')
    expect(await screenshot.text()).toBe('fake-jpeg-data')
  })

  it.each([undefined, null])('preserves open access for allowedOrigins=%s', async (origins) => {
    const app = await createServer({ allowedOrigins: origins })
    expect((await postEvents(app, blockedOrigin)).status).toBe(200)
  })

  it('rejects all browser origins when the allowlist is empty', async () => {
    const app = await createServer({ allowedOrigins: [] })
    expect((await postEvents(app, allowedOrigin)).status).toBe(403)
  })

  it('preserves originless server-to-server access', async () => {
    const app = await createServer({ allowedOrigins: [] })
    expect((await postEvents(app)).status).toBe(200)
  })

  it('enforces the allowlist before configured API routes', async () => {
    const app = await createServer({
      allowedOrigins: [allowedOrigin],
      configure: (configuredApp) => {
        configuredApp.get('/api/custom', (c) => c.json({ ok: true }))
      },
    })

    const blocked = await app.request('/api/custom', { headers: { Origin: blockedOrigin } })
    expect(blocked.status).toBe(403)
    const allowed = await app.request('/api/custom', { headers: { Origin: allowedOrigin } })
    expect(allowed.status).toBe(200)
  })
})
