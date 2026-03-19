/**
 * Server-side security middleware for snapfeed-server.
 *
 * Provides rate limiting, origin allowlisting, and payload size validation.
 */

import type { Context, Next } from 'hono'

// ── Rate Limiting ────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Max requests per window. Default: 60 */
  max?: number
  /** Window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

export function rateLimit(options: RateLimitOptions = {}) {
  const max = options.max ?? 60
  const windowMs = options.windowMs ?? 60_000
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup to prevent memory leaks
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, windowMs * 2).unref?.()

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'

    const now = Date.now()
    let entry = store.get(ip)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(ip, entry)
    }

    entry.count++

    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > max) {
      return c.json(
        { error: 'Too many requests', retryAfter: Math.ceil((entry.resetAt - now) / 1000) },
        429,
      )
    }

    await next()
  }
}

// ── Origin Allowlist ─────────────────────────────────────────────────

export interface OriginAllowlistOptions {
  /** Allowed origins. Exact strings or RegExp patterns. */
  origins: (string | RegExp)[]
}

export function originAllowlist(options: OriginAllowlistOptions) {
  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin')

    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) {
      await next()
      return
    }

    const allowed = options.origins.some((pattern) =>
      typeof pattern === 'string' ? pattern === origin : pattern.test(origin),
    )

    if (!allowed) {
      return c.json({ error: 'Origin not allowed' }, 403)
    }

    await next()
  }
}

// ── Payload Size Limits ──────────────────────────────────────────────

export interface PayloadLimitOptions {
  /** Max payload size in bytes (excluding screenshot). Default: 10_000 (10KB) */
  maxPayloadBytes?: number
  /** Max screenshot size in bytes (base64 decoded). Default: 5_242_880 (5MB) */
  maxScreenshotBytes?: number
}

export function payloadLimits(options: PayloadLimitOptions = {}) {
  const maxPayload = options.maxPayloadBytes ?? 10_000
  const maxScreenshot = options.maxScreenshotBytes ?? 5_242_880

  return async (c: Context, next: Next) => {
    if (c.req.method !== 'POST') {
      await next()
      return
    }

    const contentLength = Number(c.req.header('content-length') || 0)
    // Rough upper bound: maxPayload + maxScreenshot * 1.37 (base64 overhead)
    const hardLimit = maxPayload + Math.ceil(maxScreenshot * 1.37) + 1000
    if (contentLength > hardLimit) {
      return c.json({ error: 'Payload too large' }, 413)
    }

    // Clone and inspect the body for screenshot sizes
    const body = await c.req.json()
    const events = body?.events as Array<Record<string, unknown>> | undefined

    if (Array.isArray(events)) {
      for (const event of events) {
        if (typeof event.screenshot === 'string') {
          const screenshotBytes = Math.ceil((event.screenshot.length * 3) / 4)
          if (screenshotBytes > maxScreenshot) {
            return c.json(
              { error: `Screenshot exceeds ${Math.round(maxScreenshot / 1_048_576)}MB limit` },
              413,
            )
          }
        }

        // Check non-screenshot payload size
        const withoutScreenshot = { ...event, screenshot: undefined }
        const payloadSize = new TextEncoder().encode(JSON.stringify(withoutScreenshot)).length
        if (payloadSize > maxPayload) {
          return c.json({ error: `Event payload exceeds ${maxPayload} byte limit` }, 413)
        }
      }
    }

    // Re-set the parsed body so routes don't have to parse again
    c.set('parsedBody', body)
    await next()
  }
}
