/**
 * Unit tests for all snapfeed client adapters.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discordAdapter } from './adapters/discord.js'
import { githubAdapter } from './adapters/github.js'
import { linearAdapter } from './adapters/linear.js'
import { slackAdapter } from './adapters/slack.js'
import { telegramAdapter } from './adapters/telegram.js'
import { consoleAdapter, webhookAdapter } from './adapters.js'
import type { TelemetryEvent } from './types.js'

// ── Shared mock event ────────────────────────────────────────────────

const mockEvent: TelemetryEvent = {
  session_id: 'test-session',
  seq: 1,
  ts: '2026-03-19T18:00:00.000Z',
  event_type: 'feedback',
  page: '/dashboard',
  target: 'button.save',
  detail: {
    message: 'Something is broken',
    category: 'bug',
    user: { name: 'Jane' },
    consoleErrors: ['Error: fail'],
  },
  screenshot: null,
}

const mockEventWithScreenshot: TelemetryEvent = {
  ...mockEvent,
  screenshot: btoa('fake-image-data'),
}

// ── Helpers ──────────────────────────────────────────────────────────

function mockFetchOk(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function mockFetchFail(status = 500, body = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  })
}

function mockFetchThrow(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message))
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
})

// ── consoleAdapter ───────────────────────────────────────────────────

describe('consoleAdapter', () => {
  it('logs to console and returns ok', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter()

    expect(adapter.name).toBe('console')
    const result = await adapter.send(mockEvent)

    expect(result).toEqual({ ok: true })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('[snapfeed:console]', {
      text: 'button.save',
      page: '/dashboard',
      detail: mockEvent.detail,
      hasScreenshot: false,
    })
  })

  it('reports hasScreenshot true when screenshot present', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = consoleAdapter()
    await adapter.send(mockEventWithScreenshot)

    expect(spy).toHaveBeenCalledWith(
      '[snapfeed:console]',
      expect.objectContaining({ hasScreenshot: true }),
    )
  })
})

// ── webhookAdapter ───────────────────────────────────────────────────

describe('webhookAdapter', () => {
  it('POSTs to the URL with JSON body on success', async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter('https://hooks.example.com/test')
    expect(adapter.name).toBe('webhook')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://hooks.example.com/test')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toMatchObject({ session_id: 'test-session' })
  })

  it('uses custom headers and transform', async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const adapter = webhookAdapter('https://hooks.example.com/test', {
      headers: { 'X-Custom': 'val' },
      transform: (e) => ({ msg: (e.detail as Record<string, unknown>)?.message }),
    })
    await adapter.send(mockEvent)

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Custom']).toBe('val')
    expect(JSON.parse(init.body)).toEqual({ msg: 'Something is broken' })
  })

  it('returns error on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(502))
    const result = await webhookAdapter('https://hooks.example.com/test').send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'HTTP 502' })
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('Connection refused'))
    const result = await webhookAdapter('https://hooks.example.com/test').send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'Connection refused' })
  })
})

// ── githubAdapter ────────────────────────────────────────────────────

describe('githubAdapter', () => {
  const opts = { token: 'ghp_test', owner: 'acme', repo: 'app' }

  it('creates a GitHub issue and returns deliveryId', async () => {
    const fetchMock = mockFetchOk({ number: 42 })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = githubAdapter(opts)
    expect(adapter.name).toBe('github')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true, deliveryId: '42' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/acme/app/issues')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer ghp_test')

    const body = JSON.parse(init.body)
    expect(body.title).toContain('[Feedback]')
    expect(body.title).toContain('Something is broken')
    expect(body.labels).toContain('feedback')
    expect(body.body).toContain('**Category:** bug')
    expect(body.body).toContain('**User:** Jane')
    expect(body.body).toContain('Error: fail')
  })

  it('includes screenshot in issue body', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ number: 7 }))
    const result = await githubAdapter(opts).send(mockEventWithScreenshot)
    expect(result.ok).toBe(true)

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.body).toContain('![feedback screenshot]')
  })

  it('applies categoryLabels', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ number: 1 }))
    const adapter = githubAdapter({ ...opts, categoryLabels: { bug: 'type:bug' } })
    await adapter.send(mockEvent)

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.labels).toContain('type:bug')
  })

  it('returns error on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(422, 'Validation Failed'))
    const result = await githubAdapter(opts).send(mockEvent)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('422')
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('DNS error'))
    const result = await githubAdapter(opts).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'DNS error' })
  })
})

// ── slackAdapter ─────────────────────────────────────────────────────

describe('slackAdapter', () => {
  const webhookUrl = 'https://hooks.slack.com/services/T/B/xxx'

  it('posts Slack blocks on success', async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const adapter = slackAdapter({ webhookUrl })
    expect(adapter.name).toBe('slack')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(webhookUrl)
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.blocks).toBeDefined()
    expect(body.blocks.length).toBeGreaterThanOrEqual(3)
    expect(body.blocks[0].type).toBe('header')
    expect(body.username).toBe('Snapfeed')
  })

  it('includes console errors in blocks', async () => {
    vi.stubGlobal('fetch', mockFetchOk())
    await slackAdapter({ webhookUrl }).send(mockEvent)

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    const errorBlock = body.blocks.find(
      (b: Record<string, unknown>) =>
        b.type === 'section' &&
        (b.text as Record<string, string>)?.text?.includes('Console Errors'),
    )
    expect(errorBlock).toBeDefined()
  })

  it('returns error on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(500))
    const result = await slackAdapter({ webhookUrl }).send(mockEvent)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('Timeout'))
    const result = await slackAdapter({ webhookUrl }).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'Timeout' })
  })
})

// ── telegramAdapter ──────────────────────────────────────────────────

describe('telegramAdapter', () => {
  const opts = { botToken: '123:ABC', chatId: '456' }

  it('sends text message when no screenshot', async () => {
    const fetchMock = mockFetchOk({ result: { message_id: 99 } })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = telegramAdapter(opts)
    expect(adapter.name).toBe('telegram')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true, deliveryId: '99' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage')
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.chat_id).toBe('456')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain('Feedback')
  })

  it('sends photo when screenshot present', async () => {
    const fetchMock = mockFetchOk({ result: { message_id: 100 } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await telegramAdapter(opts).send(mockEventWithScreenshot)
    expect(result).toEqual({ ok: true, deliveryId: '100' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:ABC/sendPhoto')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('returns error on non-ok sendMessage response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(403, 'Bot blocked'))
    const result = await telegramAdapter(opts).send(mockEvent)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
  })

  it('returns error on non-ok sendPhoto response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(400, 'Bad Request'))
    const result = await telegramAdapter(opts).send(mockEventWithScreenshot)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('400')
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('Socket closed'))
    const result = await telegramAdapter(opts).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'Socket closed' })
  })
})

// ── discordAdapter ───────────────────────────────────────────────────

describe('discordAdapter', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/123/token'

  it('posts embeds without screenshot', async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const adapter = discordAdapter({ webhookUrl })
    expect(adapter.name).toBe('discord')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(webhookUrl)
    expect(init.method).toBe('POST')

    const body = JSON.parse(init.body)
    expect(body.username).toBe('Snapfeed')
    expect(body.embeds).toHaveLength(1)
    expect(body.embeds[0].title).toContain('Feedback')
    expect(body.embeds[0].description).toBe('Something is broken')
    expect(body.embeds[0].color).toBe(0xed4245) // bug color
    expect(body.embeds[0].fields.length).toBeGreaterThanOrEqual(2)
  })

  it('uses FormData for screenshot uploads', async () => {
    const fetchMock = mockFetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const result = await discordAdapter({ webhookUrl }).send(mockEventWithScreenshot)
    expect(result).toEqual({ ok: true })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('returns error on non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(429, 'Rate limited'))
    const result = await discordAdapter({ webhookUrl }).send(mockEvent)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('429')
  })

  it('returns error on non-ok response with screenshot', async () => {
    vi.stubGlobal('fetch', mockFetchFail(413, 'Payload Too Large'))
    const result = await discordAdapter({ webhookUrl }).send(mockEventWithScreenshot)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('413')
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('ECONNRESET'))
    const result = await discordAdapter({ webhookUrl }).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'ECONNRESET' })
  })
})

// ── linearAdapter ────────────────────────────────────────────────────

describe('linearAdapter', () => {
  const opts = { apiKey: 'lin_api_test', teamId: 'team-1' }

  it('creates a Linear issue via GraphQL and returns identifier', async () => {
    const fetchMock = mockFetchOk({
      data: { issueCreate: { success: true, issue: { identifier: 'ENG-42' } } },
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = linearAdapter(opts)
    expect(adapter.name).toBe('linear')

    const result = await adapter.send(mockEvent)
    expect(result).toEqual({ ok: true, deliveryId: 'ENG-42' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.linear.app/graphql')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('lin_api_test')

    const body = JSON.parse(init.body)
    expect(body.query).toContain('issueCreate')
    expect(body.variables.input.teamId).toBe('team-1')
    expect(body.variables.input.title).toContain('[Feedback]')
    expect(body.variables.input.priority).toBe(3)
  })

  it('includes screenshot in description', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOk({ data: { issueCreate: { success: true, issue: { identifier: 'X-1' } } } }),
    )
    await linearAdapter(opts).send(mockEventWithScreenshot)

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.variables.input.description).toContain('![screenshot]')
  })

  it('returns GraphQL errors', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ errors: [{ message: 'Team not found' }] }))
    const result = await linearAdapter(opts).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'Team not found' })
  })

  it('returns error on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', mockFetchFail(401, 'Unauthorized'))
    const result = await linearAdapter(opts).send(mockEvent)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', mockFetchThrow('TLS error'))
    const result = await linearAdapter(opts).send(mockEvent)
    expect(result).toEqual({ ok: false, error: 'TLS error' })
  })
})
