// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flush, getQueue, push, startFlushing, stopFlushing } from './queue.js'
import { resolveConfig } from './types.js'

afterEach(async () => {
  stopFlushing()
  await flush()
  vi.unstubAllGlobals()
})

describe('telemetry request headers', () => {
  it('preserves default JSON delivery without configured headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    startFlushing(resolveConfig())
    push('feedback', 'message', null)
    expect(await flush()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/telemetry/events',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('keeps JSON headers and adds configured authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    startFlushing(resolveConfig({ headers: { Authorization: 'Bearer runtime-test-token' } }))
    push('feedback', 'message', null)
    expect(await flush()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/telemetry/events',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer runtime-test-token' },
      }),
    )
  })

  it('resolves runtime headers for each retry without storing them in telemetry', async () => {
    let token = 'expired-test-token'
    const headers = vi.fn(() => ({ Authorization: `Bearer ${token}` }))
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    startFlushing(resolveConfig({ headers }))
    push('feedback', 'message', null)
    expect(await flush()).toBe(false)
    expect(getQueue()).toHaveLength(1)
    token = 'refreshed-test-token'
    expect(await flush()).toBe(true)
    expect(headers).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-test-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-test-token')
    expect(fetchMock.mock.calls[1][1].body).not.toContain(token)
  })

  it('retains the batch when the runtime header provider fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    startFlushing(
      resolveConfig({
        headers: () => {
          throw new Error('Token unavailable')
        },
      }),
    )
    push('feedback', 'message', null)
    expect(await flush()).toBe(false)
    expect(getQueue()).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
    startFlushing(resolveConfig())
    expect(await flush()).toBe(true)
  })
})
