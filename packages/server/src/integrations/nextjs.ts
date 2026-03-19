/**
 * Next.js App Router integration for snapfeed-server.
 *
 * Usage in app/api/feedback/route.ts:
 *
 *   import { createFeedbackHandler } from '@microsoft/snapfeed-server/nextjs'
 *   import { slackAdapter } from '@microsoft/snapfeed/adapters'
 *
 *   const handler = createFeedbackHandler({
 *     adapters: [slackAdapter({ webhookUrl: '...' })],
 *   })
 *
 *   export const POST = handler.POST
 *   export const GET = handler.GET
 */

import type { TelemetryBatch, TelemetryEvent } from '../types.js'

export interface FeedbackAdapter {
  name: string
  send(event: TelemetryEvent): Promise<{ ok: boolean; error?: string; deliveryId?: string }>
}

export interface FeedbackHandlerConfig {
  /** Adapters to deliver feedback through. */
  adapters: FeedbackAdapter[]
  /** Called before adapters run. Return false to reject. */
  onReceive?: (event: TelemetryEvent) => boolean | Promise<boolean>
  /** Called after all adapters complete. */
  onComplete?: (
    event: TelemetryEvent,
    results: Array<{ ok: boolean; error?: string }>,
  ) => void | Promise<void>
  /** Rate limit config. */
  rateLimit?: { max?: number; windowMs?: number }
  /** Allowed origins. Null = allow all. */
  allowedOrigins?: (string | RegExp)[] | null
  /** Max payload bytes (excl. screenshot). Default: 10000 */
  maxPayloadBytes?: number
  /** Max screenshot bytes. Default: 5MB */
  maxScreenshotBytes?: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

export function createFeedbackHandler(config: FeedbackHandlerConfig) {
  const rateLimitMax = config.rateLimit?.max ?? 60
  const rateLimitWindow = config.rateLimit?.windowMs ?? 60_000
  const maxPayload = config.maxPayloadBytes ?? 10_000
  const maxScreenshot = config.maxScreenshotBytes ?? 5_242_880
  const rateLimitStore = new Map<string, RateLimitEntry>()

  function getIp(request: Request): string {
    const headers = new Headers(request.headers)
    return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  }

  function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now()
    let entry = rateLimitStore.get(ip)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + rateLimitWindow }
      rateLimitStore.set(ip, entry)
    }
    entry.count++
    if (entry.count > rateLimitMax) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
    }
    return { allowed: true }
  }

  function checkOrigin(request: Request): boolean {
    if (!config.allowedOrigins) return true
    const origin = request.headers.get('origin')
    if (!origin) return true
    return config.allowedOrigins.some((p) =>
      typeof p === 'string' ? p === origin : p.test(origin),
    )
  }

  async function POST(request: Request): Promise<Response> {
    // Origin check
    if (!checkOrigin(request)) {
      return Response.json({ error: 'Origin not allowed' }, { status: 403 })
    }

    // Rate limit
    const ip = getIp(request)
    const rl = checkRateLimit(ip)
    if (!rl.allowed) {
      return Response.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        { status: 429 },
      )
    }

    const body = (await request.json()) as TelemetryBatch
    const events = body?.events
    if (!Array.isArray(events) || events.length === 0) {
      return Response.json({ error: 'events array required' }, { status: 400 })
    }

    const allResults: Array<{
      event: TelemetryEvent
      results: Array<{ ok: boolean; error?: string }>
    }> = []

    for (const event of events) {
      // Payload size check
      const withoutScreenshot = { ...event, screenshot: undefined }
      const payloadSize = new TextEncoder().encode(JSON.stringify(withoutScreenshot)).length
      if (payloadSize > maxPayload) {
        return Response.json({ error: 'Event payload too large' }, { status: 413 })
      }
      if (event.screenshot) {
        const screenshotBytes = Math.ceil((event.screenshot.length * 3) / 4)
        if (screenshotBytes > maxScreenshot) {
          return Response.json({ error: 'Screenshot too large' }, { status: 413 })
        }
      }

      // onReceive hook
      if (config.onReceive) {
        const allowed = await config.onReceive(event)
        if (!allowed) continue
      }

      // Fan out to adapters
      const results = await Promise.allSettled(config.adapters.map((a) => a.send(event)))
      const mapped = results.map((r) =>
        r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) },
      )

      allResults.push({ event, results: mapped })

      if (config.onComplete) {
        await config.onComplete(event, mapped)
      }
    }

    return Response.json({ accepted: allResults.length })
  }

  async function GET(): Promise<Response> {
    return Response.json({ status: 'ok', adapters: config.adapters.map((a) => a.name) })
  }

  return { POST, GET }
}
