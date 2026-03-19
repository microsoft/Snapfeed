/**
 * Built-in feedback adapters.
 */

import type { FeedbackAdapter, AdapterResult, TelemetryEvent } from './types.js'

/** Console adapter — logs feedback to the developer console. */
export function consoleAdapter(): FeedbackAdapter {
  return {
    name: 'console',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      console.log('[snapfeed:console]', {
        text: event.target,
        page: event.page,
        detail: event.detail,
        hasScreenshot: !!event.screenshot,
      })
      return { ok: true }
    },
  }
}

/** Webhook adapter — POSTs feedback to an arbitrary URL. */
export function webhookAdapter(url: string, options?: {
  headers?: Record<string, string>
  /** Transform event before sending. */
  transform?: (event: TelemetryEvent) => unknown
}): FeedbackAdapter {
  return {
    name: 'webhook',
    async send(event: TelemetryEvent): Promise<AdapterResult> {
      try {
        const body = options?.transform ? options.transform(event) : event
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...options?.headers },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}` }
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message ?? err) }
      }
    },
  }
}
