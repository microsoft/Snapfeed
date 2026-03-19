/**
 * Event queue — batching, flushing, and retry logic.
 *
 * Events accumulate in memory and are flushed to the backend periodically.
 * On flush failure, events are put back for retry.
 */

import type { ResolvedConfig, TelemetryEvent } from './types.js'

const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

let seq = 0
const queue: TelemetryEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let config: ResolvedConfig | null = null

export function getSessionId(): string {
  return SESSION_ID
}

export function getQueue(): readonly TelemetryEvent[] {
  return queue
}

function now(): string {
  return new Date().toISOString()
}

/** Push an event onto the queue. */
export function push(
  event_type: string,
  target: string | null,
  detail: Record<string, unknown> | null,
  screenshot?: string | null,
): void {
  if (!config) return
  queue.push({
    session_id: SESSION_ID,
    seq: seq++,
    ts: now(),
    event_type,
    page: window.location.pathname,
    target,
    detail,
    screenshot: screenshot ?? null,
  })
  if (queue.length > config.maxQueueSize) queue.splice(0, queue.length - config.maxQueueSize)
}

/** Flush the queue to the backend. */
export async function flush(): Promise<void> {
  if (!config || queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    })
  } catch {
    // Put events back if the backend is down
    queue.unshift(...batch)
    if (config && queue.length > config.maxQueueSize) queue.splice(config.maxQueueSize)
  }
}

/** Start periodic flushing. */
export function startFlushing(resolvedConfig: ResolvedConfig): void {
  config = resolvedConfig
  if (flushTimer) clearInterval(flushTimer)
  flushTimer = setInterval(flush, config.flushIntervalMs)
}

/** Stop periodic flushing and flush remaining events. */
export function stopFlushing(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  flush()
}
